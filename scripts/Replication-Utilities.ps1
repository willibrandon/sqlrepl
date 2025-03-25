<#
.SYNOPSIS
    Shared utility functions for SQL Server replication management scripts.
    
.DESCRIPTION
    This module provides common functions for SQL Server replication scripts including:
    - Logging with multiple output targets
    - Connection testing and management
    - SQL Server version validation
    - Error handling
    - Replication-specific helper functions
    
.NOTES
    Author: DevOps Team
    Version: 1.0
#>

# Ensure the SqlServer module is available (newer versions of SQL/PowerShell)
try {
    Import-Module SqlServer -ErrorAction Stop
} catch {
    # Fallback to legacy SQLPS if SqlServer is not available
    try {
        Import-Module SQLPS -DisableNameChecking -ErrorAction Stop
    } catch {
        throw "Neither SqlServer nor SQLPS modules are available. Please install the SqlServer module: Install-Module -Name SqlServer -AllowClobber"
    }
}

function Write-Log {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        
        [Parameter()]
        [ValidateSet("Info","Warning","Error","Success")]
        [string]$Level = "Info",

        [Parameter()]
        [switch]$WriteToEventLog,

        [Parameter()]
        [switch]$WriteToSqlTable,
        
        [Parameter()]
        [string]$LoggingDb,
        
        [Parameter()]
        [string]$LoggingServer
    )

    $timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    $logOutput = "$timestamp [$Level] : $Message"

    # Console output with appropriate colors
    switch ($Level) {
        "Info"    { Write-Host $logOutput -ForegroundColor Gray }
        "Warning" { Write-Warning $logOutput }
        "Error"   { Write-Error $logOutput }
        "Success" { Write-Host $logOutput -ForegroundColor Green }
    }

    # Write to event log if requested
    if ($WriteToEventLog) {
        $eventType = switch ($Level) {
            "Info"    { "Information" }
            "Warning" { "Warning" }
            "Error"   { "Error" }
            "Success" { "Information" }
        }
        
        # Create event source if it doesn't exist
        if (-not [System.Diagnostics.EventLog]::SourceExists("SQLReplicationScript")) {
            try {
                [System.Diagnostics.EventLog]::CreateEventSource("SQLReplicationScript", "Application")
            } catch {
                Write-Warning "Unable to create event source 'SQLReplicationScript'. Event log entries will not be created."
            }
        }
        
        try {
            Write-EventLog -LogName Application -Source "SQLReplicationScript" -EventId 1000 -EntryType $eventType -Message $logOutput
        } catch {
            Write-Warning "Failed to write to event log: $_"
        }
    }

    # Write to a SQL logging table if requested
    if ($WriteToSqlTable) {
        try {
            if (-not $LoggingServer) { $LoggingServer = "." }
            if (-not $LoggingDb) { $LoggingDb = "DBA_Admin" }
            
            # Ensure the SQL table exists
            $createTableQuery = @"
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ReplicationLog')
BEGIN
    CREATE TABLE [dbo].[ReplicationLog] (
        [LogId] INT IDENTITY(1,1) PRIMARY KEY,
        [Timestamp] DATETIME2 NOT NULL DEFAULT GETDATE(),
        [Level] NVARCHAR(50) NOT NULL,
        [Message] NVARCHAR(MAX) NOT NULL,
        [ServerName] NVARCHAR(255) NOT NULL,
        [UserName] NVARCHAR(255) NOT NULL
    )
END
"@
            Invoke-Sqlcmd -ServerInstance $LoggingServer -Database $LoggingDb -Query $createTableQuery -ErrorAction Stop
            
            # Insert the log entry
            $cleanMessage = $Message.Replace("'", "''")
            $serverName = $env:COMPUTERNAME
            $userName = $env:USERNAME
            $insertQuery = "INSERT INTO [dbo].[ReplicationLog] ([Level], [Message], [ServerName], [UserName]) VALUES ('$Level', '$cleanMessage', '$serverName', '$userName')"
            Invoke-Sqlcmd -ServerInstance $LoggingServer -Database $LoggingDb -Query $insertQuery -ErrorAction Stop
        }
        catch {
            Write-Warning "Failed to write log to SQL table: $_"
        }
    }
}

function Test-SqlConnection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ServerInstance,

        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential,
        
        [Parameter()]
        [int]$TimeoutSeconds = 30
    )
    
    try {
        $connectionString = "Server=$ServerInstance;Connection Timeout=$TimeoutSeconds"
        if ($SqlCredential) {
            $connectionString += ";User ID=$($SqlCredential.UserName);Password=$($SqlCredential.GetNetworkCredential().Password)"
        } else {
            $connectionString += ";Integrated Security=True"
        }
        
        $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
        $connection.Open()
        $connection.Close()
        
        Write-Log "Successfully connected to SQL Server instance '$ServerInstance'" -Level Success
        return $true
    }
    catch {
        Write-Log "Failed to connect to SQL Server instance '$ServerInstance': $_" -Level Error
        return $false
    }
}

function Validate-SqlVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ServerInstance,

        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential,

        [Parameter()]
        [ValidateSet("2014","2016","2017","2019","2022")]
        [string]$MinVersion = "2016"
    )

    $query = "SELECT SERVERPROPERTY('ProductVersion') as Version, SERVERPROPERTY('ProductMajorVersion') as MajorVersion"
    try {
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        } else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        
        $fullVersion = $result.Version
        $major = [int]$result.MajorVersion

        # Map major versions to release
        $versionMap = @{
            12 = "2014"
            13 = "2016"
            14 = "2017"
            15 = "2019"
            16 = "2022"
        }
        
        if ($versionMap.ContainsKey($major)) {
            $serverVersion = $versionMap[$major]
            Write-Log "SQL Server Instance '$ServerInstance' is running version $serverVersion (Version=$fullVersion)" -Level Info

            # Compare version
            if ([array]::IndexOf($versionMap.Values, $serverVersion) -lt [array]::IndexOf($versionMap.Values, $MinVersion)) {
                Write-Log "$ServerInstance is running $serverVersion, which is below minimum required version $MinVersion" -Level Warning
                return $false
            }
            return $true
        }
        else {
            Write-Log "Unknown SQL Server version (Version=$fullVersion). Proceed with caution." -Level Warning
            return $false
        }
    }
    catch {
        Write-Log "Failed to retrieve version info from '$ServerInstance': $_" -Level Error
        return $false
    }
}

function Get-SqlDefaultDataPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ServerInstance,

        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $query = "SELECT SERVERPROPERTY('InstanceDefaultDataPath') as DataPath"
    try {
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        } else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result.DataPath
    }
    catch {
        Write-Log "Failed to retrieve default data path from '$ServerInstance': $_" -Level Error
        # Return a reasonable default if we can't get the actual path
        return "C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\DATA\"
    }
}

function Get-SqlDefaultLogPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ServerInstance,

        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $query = "SELECT SERVERPROPERTY('InstanceDefaultLogPath') as LogPath"
    try {
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        } else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result.LogPath
    }
    catch {
        Write-Log "Failed to retrieve default log path from '$ServerInstance': $_" -Level Error
        # Return a reasonable default if we can't get the actual path
        return "C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\DATA\"
    }
}

function Test-Distributor {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    try {
        $query = "EXEC sp_get_distributor"
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error checking distributor status: $_" -Level Error
        return $null
    }
}

function Get-ReplicationJobs {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    try {
        $query = @"
SELECT name, job_id, enabled
FROM msdb.dbo.sysjobs 
WHERE category_id IN (
    SELECT category_id 
    FROM msdb.dbo.syscategories 
    WHERE name = 'REPL-Distribution' 
       OR name = 'REPL-Merge' 
       OR name = 'REPL-LogReader'
       OR name = 'REPL-Snapshot'
       OR name = 'REPL-QueueReader'
)
"@
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error getting replication jobs: $_" -Level Error
        return $null
    }
}

function Test-DistributionDatabase {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter()]
        [string]$DistributionDB = "distribution",
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $query = "SELECT CASE WHEN DB_ID('$DistributionDB') IS NOT NULL THEN 1 ELSE 0 END as Exists"
    try {
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result.Exists -eq 1
    }
    catch {
        Write-Log "Error checking for distribution database: $_" -Level Error
        return $false
    }
}

function Get-PublicationInfo {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter(Mandatory)]
        [string]$PublicationDB,
        
        [Parameter()]
        [string]$PublicationName,
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = "USE [$PublicationDB]; EXEC sp_helppublication"
        if ($PublicationName) {
            $query = "USE [$PublicationDB]; EXEC sp_helppublication @publication = '$PublicationName'"
        }
        
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error getting publication information: $_" -Level Error
        return $null
    }
}

function Get-SubscriptionInfo {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter(Mandatory)]
        [string]$PublicationDB,
        
        [Parameter(Mandatory)]
        [string]$PublicationName,
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = "USE [$PublicationDB]; EXEC sp_helpsubscription @publication = '$PublicationName'"
        
        if ($SqlCredential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $SqlCredential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error getting subscription information: $_" -Level Error
        return $null
    }
}

function Invoke-SqlCmdWithLogging {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ServerInstance,
        
        [Parameter(Mandatory)]
        [string]$Query,
        
        [Parameter()]
        [string]$Database,
        
        [Parameter()]
        [System.Management.Automation.PSCredential]$SqlCredential,
        
        [Parameter()]
        [string]$LogMessage,
        
        [Parameter()]
        [string]$LogErrorMessage
    )
    
    try {
        if ($LogMessage) {
            Write-Log $LogMessage -Level Info
        }
        
        if ($Database) {
            if ($SqlCredential) {
                $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Database $Database -Query $Query -Credential $SqlCredential -ErrorAction Stop
            }
            else {
                $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Database $Database -Query $Query -ErrorAction Stop
            }
        }
        else {
            if ($SqlCredential) {
                $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $Query -Credential $SqlCredential -ErrorAction Stop
            }
            else {
                $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $Query -ErrorAction Stop
            }
        }
        
        return $result
    }
    catch {
        if ($LogErrorMessage) {
            Write-Log "$LogErrorMessage`: $_" -Level Error
        }
        else {
            Write-Log "Error executing SQL query on $ServerInstance`: $_" -Level Error
        }
        return $null
    }
} 
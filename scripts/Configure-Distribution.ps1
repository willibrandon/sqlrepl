<#
.SYNOPSIS
    Configures SQL Server replication distributor on a local or remote server.

.DESCRIPTION
    This script sets up a distribution server for SQL Server replication. It can configure 
    either a local distributor (where publisher and distributor are the same server) or a 
    remote distributor. It handles creating the distribution database, setting up required 
    security settings, and configuring retention policies.

.PARAMETER ServerInstance
    The SQL Server instance to configure as a publisher or as a distributor (for local distribution).

.PARAMETER DistributionDB
    The name of the distribution database. Default is "distribution".

.PARAMETER SnapshotFolder
    The folder for storing replication snapshot files. Default is "\\ServerInstance\Repldata".

.PARAMETER DistributionRetention
    Maximum distribution retention time in hours. Default is 72 hours (3 days).

.PARAMETER HistoryRetention
    Maximum history retention time in hours. Default is 48 hours (2 days).

.PARAMETER RemoteDistributor
    Optional: If specified, configures a remote distributor with this server name.

.PARAMETER DistributorPassword
    Required when using a remote distributor: The password for the distributor admin connection.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials if not using Windows Authentication.

.PARAMETER Force
    Switch to force recreation if a distributor is already configured.

.PARAMETER LogToEventLog
    Switch to enable logging to the Windows Event Log.

.PARAMETER LogToSqlTable
    Switch to enable logging to a SQL Server table.

.PARAMETER LoggingServerInstance
    The SQL Server instance for logging if LogToSqlTable is enabled.

.PARAMETER LoggingDatabase
    The database for logging if LogToSqlTable is enabled.

.EXAMPLE
    .\Configure-Distribution.ps1 -ServerInstance "SQLSERVER1\INSTANCE1"
    
    Configures SQL Server instance SQLSERVER1\INSTANCE1 as both the publisher and distributor.

.EXAMPLE
    .\Configure-Distribution.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -RemoteDistributor "SQLSERVER2\INSTANCE1" -DistributorPassword (Read-Host -AsSecureString "Enter distributor password")
    
    Configures SQL Server instance SQLSERVER1\INSTANCE1 as a publisher with SQLSERVER2\INSTANCE1 as the remote distributor.

.NOTES
    Version: 1.1
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServerInstance,

    [Parameter(Position = 1)]
    [string]$DistributionDB = "distribution",

    [Parameter(Position = 2)]
    [string]$SnapshotFolder,

    [Parameter()]
    [ValidateRange(0, 8760)]  # 0 hours to 1 year
    [int]$DistributionRetention = 72,

    [Parameter()]
    [ValidateRange(0, 8760)]  # 0 hours to 1 year
    [int]$HistoryRetention = 48,

    [Parameter()]
    [string]$RemoteDistributor,

    [Parameter()]
    [System.Security.SecureString]$DistributorPassword,

    [Parameter()]
    [System.Management.Automation.PSCredential]$SqlCredential,
    
    [Parameter()]
    [switch]$Force,
    
    [Parameter()]
    [switch]$LogToEventLog,
    
    [Parameter()]
    [switch]$LogToSqlTable,
    
    [Parameter()]
    [string]$LoggingServerInstance,
    
    [Parameter()]
    [string]$LoggingDatabase = "DBA_Admin"
)

# Dot-source the utilities module
try {
    . "$PSScriptRoot\Replication-Utilities.ps1"
}
catch {
    Write-Error "Unable to load Replication-Utilities.ps1. Ensure it exists in the script directory. Error: $_"
    exit 1
}

# Set default snapshot folder if not provided
if (-not $SnapshotFolder) {
    if ($RemoteDistributor) {
        $SnapshotFolder = "\\$RemoteDistributor\Repldata"
    } else {
        $SnapshotFolder = "\\$ServerInstance\Repldata"
    }
}

# Validate parameters
if ($RemoteDistributor -and -not $DistributorPassword) {
    Write-Log "DistributorPassword is required when configuring a remote distributor" -Level Error -WriteToEventLog:$LogToEventLog
    throw "DistributorPassword is required when configuring a remote distributor"
}

function Install-LocalDistributor {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$DistributionDB,
        [string]$SnapshotFolder,
        [int]$DistributionRetention,
        [int]$HistoryRetention,
        [System.Management.Automation.PSCredential]$Credential
    )
    
    try {
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Configure as local distributor")) {
            # Install the distributor
            $query = "EXEC sp_adddistributor @distributor = N'$ServerInstance'"
            
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $Credential `
                -LogMessage "Configuring server as distributor" `
                -LogErrorMessage "Error configuring server as distributor"
            
            # Get the default paths
            $dataPath = Get-SqlDefaultDataPath -ServerInstance $ServerInstance -SqlCredential $Credential
            $logPath = Get-SqlDefaultLogPath -ServerInstance $ServerInstance -SqlCredential $Credential
            
            # Create the distribution database
            $query = @"
EXEC sp_adddistributiondb 
    @database = N'$DistributionDB',
    @data_folder = N'$dataPath',
    @data_file = N'$DistributionDB',
    @data_file_size = 10,
    @log_folder = N'$logPath',
    @log_file = N'$($DistributionDB)_log',
    @log_file_size = 5,
    @min_distretention = 0,
    @max_distretention = $DistributionRetention,
    @history_retention = $HistoryRetention,
    @security_mode = 1
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $Credential `
                -LogMessage "Creating distribution database '$DistributionDB'" `
                -LogErrorMessage "Error creating distribution database"
            
            # Configure the distribution publisher
            $query = @"
EXEC sp_adddistpublisher 
    @publisher = N'$ServerInstance',
    @distribution_db = N'$DistributionDB',
    @working_directory = N'$SnapshotFolder',
    @security_mode = 1,
    @trusted = N'false'
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $Credential `
                -LogMessage "Registering server as publisher in distributor" `
                -LogErrorMessage "Error registering server as publisher"
            
            Write-Log "Successfully configured local distributor on '$ServerInstance'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error configuring local distributor: $_" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
        return $false
    }
}

function Install-RemoteDistributor {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$RemoteDistributor,
        [System.Security.SecureString]$DistributorPassword,
        [string]$DistributionDB,
        [string]$SnapshotFolder,
        [System.Management.Automation.PSCredential]$Credential
    )
    
    try {
        if ($PSCmdlet.ShouldProcess("$RemoteDistributor", "Configure as remote distributor for $ServerInstance")) {
            # Convert SecureString password to plain text for SQL query
            $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($DistributorPassword)
            $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
            
            # Configure the remote distributor
            $query = @"
EXEC sp_adddistributor 
    @distributor = N'$RemoteDistributor',
    @password = N'$plainPassword'

EXEC sp_adddistpublisher 
    @publisher = N'$ServerInstance',
    @distribution_db = N'$DistributionDB',
    @working_directory = N'$SnapshotFolder',
    @security_mode = 1
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $RemoteDistributor -Query $query -SqlCredential $Credential `
                -LogMessage "Configuring remote distributor '$RemoteDistributor' for publisher '$ServerInstance'" `
                -LogErrorMessage "Error configuring remote distributor"
            
            Write-Log "Successfully configured remote distributor '$RemoteDistributor' for publisher '$ServerInstance'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error configuring remote distributor: $_" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
        return $false
    }
    finally {
        if ($BSTR) {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
        }
    }
}

# Main script execution
try {
    # Validate SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }
    
    # Validate SQL version
    Validate-SqlVersion -ServerInstance $ServerInstance -SqlCredential $SqlCredential -MinVersion "2016"
    
    # Check current distributor status
    $distributorStatus = Test-Distributor -ServerInstance $ServerInstance -SqlCredential $SqlCredential
    if ($null -eq $distributorStatus) {
        throw "Failed to check distributor status"
    }
    
    # If distributor is already configured, decide what to do based on Force parameter
    if ($distributorStatus.installed -eq 1) {
        if ($Force) {
            Write-Log "Distribution is already configured on '$ServerInstance', but Force is specified. Continuing..." -Level Warning
            
            # If we're forcing, we need to clean up first - call Disable-Distribution.ps1
            Write-Log "Removing existing distributor configuration..." -Level Warning
            $disableParams = @{
                ServerInstance = $ServerInstance
                DistributionDB = $DistributionDB
                Force = $true
            }
            
            if ($SqlCredential) {
                $disableParams.Add("SqlCredential", $SqlCredential)
            }
            
            & "$PSScriptRoot\Disable-Distribution.ps1" @disableParams
        }
        else {
            Write-Log "Distribution is already configured on '$ServerInstance'. Use -Force to reconfigure." -Level Warning
            exit 0
        }
    }
    
    # Configure distribution based on whether it's local or remote
    if ($RemoteDistributor) {
        $success = Install-RemoteDistributor `
            -ServerInstance $ServerInstance `
            -RemoteDistributor $RemoteDistributor `
            -DistributorPassword $DistributorPassword `
            -DistributionDB $DistributionDB `
            -SnapshotFolder $SnapshotFolder `
            -Credential $SqlCredential
    }
    else {
        $success = Install-LocalDistributor `
            -ServerInstance $ServerInstance `
            -DistributionDB $DistributionDB `
            -SnapshotFolder $SnapshotFolder `
            -DistributionRetention $DistributionRetention `
            -HistoryRetention $HistoryRetention `
            -Credential $SqlCredential
    }
    
    if (-not $success) {
        throw "Failed to configure distribution"
    }
    
    # Create the snapshot folder if it doesn't exist
    Write-Log "Ensuring snapshot folder exists: $SnapshotFolder"
    if (-not (Test-Path $SnapshotFolder)) {
        try {
            # Create the directory
            New-Item -Path $SnapshotFolder -ItemType Directory -Force | Out-Null
            Write-Log "Created snapshot folder: $SnapshotFolder" -Level Success
        }
        catch {
            Write-Log "Warning: Could not create snapshot folder $SnapshotFolder. Please create it manually and ensure SQL Server has proper access to it." -Level Warning
        }
    }
    else {
        Write-Log "Snapshot folder already exists: $SnapshotFolder" -Level Info
    }
    
    Write-Log "Distribution configuration completed successfully." -Level Success
}
catch {
    Write-Log "Error in Configure-Distribution: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
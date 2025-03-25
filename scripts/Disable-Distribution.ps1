[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$ServerInstance,

    [Parameter(Mandatory = $false)]
    [string]$DistributionDB = "distribution",

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [System.Management.Automation.PSCredential]$SqlCredential
)

function Write-Log {
    param($Message)
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'): $Message"
}

function Test-SqlConnection {
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        $query = "SELECT @@VERSION AS Version"
        if ($Credential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $true
    }
    catch {
        Write-Log "Failed to connect to SQL Server instance '$ServerInstance': $_"
        return $false
    }
}

function Get-ReplicationJobs {
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        $query = @"
        SELECT name 
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
        if ($Credential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error getting replication jobs: $_"
        return $null
    }
}

function Stop-ReplicationJobs {
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        $jobs = Get-ReplicationJobs -ServerInstance $ServerInstance -Credential $Credential
        foreach ($job in $jobs) {
            $query = "EXEC msdb.dbo.sp_stop_job @job_name = '$($job.name)'"
            if ($Credential) {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
            }
            else {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
            }
            Write-Log "Stopped replication job: $($job.name)"
        }
        return $true
    }
    catch {
        Write-Log "Error stopping replication jobs: $_"
        return $false
    }
}

function Remove-ReplicationFromDatabases {
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        # Check if distribution database exists
        $checkQuery = "SELECT CASE WHEN DB_ID('distribution') IS NOT NULL THEN 1 ELSE 0 END as HasDistribution"
        
        if ($Credential) {
            $distDB = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $checkQuery -Credential $Credential -ErrorAction Stop
        }
        else {
            $distDB = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $checkQuery -ErrorAction Stop
        }

        if ($distDB.HasDistribution -eq 0) {
            Write-Log "Distribution database not found - skipping replication cleanup"
            return $true
        }

        # Now we know distribution DB exists, get subscription databases
        $query = @"
        SELECT DISTINCT sub.subscriber_db 
        FROM distribution.dbo.MSsubscriptions sub WITH (NOLOCK)
        INNER JOIN distribution.dbo.MSarticles art WITH (NOLOCK) ON sub.article_id = art.article_id
        WHERE EXISTS (SELECT 1 FROM distribution.dbo.MSsubscriptions)
"@
        
        try {
            if ($Credential) {
                $subDatabases = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
            }
            else {
                $subDatabases = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
            }

            # Remove replication from each subscription database
            foreach ($db in $subDatabases) {
                $query = "EXEC $($db.subscriber_db)..sp_removedbreplication"
                if ($Credential) {
                    Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
                }
                else {
                    Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
                }
                Write-Log "Removed replication from subscription database: $($db.subscriber_db)"
            }
        }
        catch {
            Write-Log "Note: No subscription databases found or error accessing them"
        }

        # Get all publication databases
        $query = @"
        SELECT DISTINCT publisher_db 
        FROM distribution.dbo.MSpublications WITH (NOLOCK)
        WHERE EXISTS (SELECT 1 FROM distribution.dbo.MSpublications)
"@
        try {
            if ($Credential) {
                $pubDatabases = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
            }
            else {
                $pubDatabases = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
            }

            # Remove replication from each publication database
            foreach ($db in $pubDatabases) {
                $query = "EXEC $($db.publisher_db)..sp_removedbreplication"
                if ($Credential) {
                    Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
                }
                else {
                    Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
                }
                Write-Log "Removed replication from publication database: $($db.publisher_db)"
            }
        }
        catch {
            Write-Log "Note: No publication databases found or error accessing them"
        }

        return $true
    }
    catch {
        Write-Log "Error removing replication from databases: $_"
        return $false
    }
}

function Remove-DistributionConfiguration {
    param (
        [string]$ServerInstance,
        [string]$DistributionDB,
        [bool]$Force,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        # Check if server is configured as a distributor using replication system tables
        $checkQuery = @"
        IF EXISTS (SELECT 1 FROM master.dbo.sysdatabases WHERE name = 'distribution')
           OR EXISTS (SELECT 1 FROM sys.databases WHERE name = 'distribution')
           OR EXISTS (SELECT 1 FROM master.dbo.sysservers WHERE srvname = @@SERVERNAME AND datasource = @@SERVERNAME AND isremote = 0)
        SELECT 1 as IsDistributor
        ELSE 
        SELECT 0 as IsDistributor
"@

        if ($Credential) {
            $isDistributor = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $checkQuery -Credential $Credential -ErrorAction Stop
        }
        else {
            $isDistributor = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $checkQuery -ErrorAction Stop
        }

        if ($isDistributor.IsDistributor -eq 0) {
            Write-Log "Server is not configured as a distributor - no cleanup needed"
            return $true
        }

        # First handle the current server as a publisher (the most common case)
        $query = "EXEC sp_dropdistpublisher @publisher = N'$ServerInstance', @no_checks = $([int]$Force)"
        try {
            if ($Credential) {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
            }
            else {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
            }
            Write-Log "Removed publisher: $ServerInstance"
        }
        catch {
            $errorMsg = $_.Exception.Message
            Write-Log "Note: Could not remove publisher $ServerInstance`: $errorMsg"
            # Continue anyway
        }

        # Drop the distribution database
        $query = "EXEC sp_dropdistributiondb @database = N'$DistributionDB'"
        try {
            if ($Credential) {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
            }
            else {
                Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
            }
            Write-Log "Dropped distribution database: $DistributionDB"
        }
        catch {
            if ($Force) {
                $errorMsg = $_.Exception.Message
                Write-Log "Warning: Could not drop distribution database: $errorMsg"
                # Continue anyway if Force is specified
            }
            else {
                throw
            }
        }

        # Finally remove the distributor with force options
        $query = "EXEC sp_dropdistributor @no_checks = 1, @ignore_distributor = 1"
        if ($Credential) {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        Write-Log "Removed distributor configuration"

        return $true
    }
    catch {
        $errorMsg = $_.Exception.Message
        Write-Log "Error removing distribution configuration: $errorMsg"
        return $false
    }
}

# Main script execution
try {
    # Import required module
    Import-Module SQLPS -DisableNameChecking -ErrorAction Stop

    # Test SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -Credential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }

    # Stop all replication jobs
    Write-Log "Stopping replication jobs..."
    if (-not (Stop-ReplicationJobs -ServerInstance $ServerInstance -Credential $SqlCredential)) {
        throw "Failed to stop replication jobs"
    }

    # Remove replication from all databases
    Write-Log "Removing replication from databases..."
    if (-not (Remove-ReplicationFromDatabases -ServerInstance $ServerInstance -Credential $SqlCredential)) {
        throw "Failed to remove replication from databases"
    }

    # Remove distribution configuration
    Write-Log "Checking distribution configuration..."
    if (-not (Remove-DistributionConfiguration -ServerInstance $ServerInstance -DistributionDB $DistributionDB -Force $Force -Credential $SqlCredential)) {
        throw "Failed to remove distribution configuration"
    }

    Write-Log "Successfully completed replication cleanup on '$ServerInstance'"
}
catch {
    $errorMsg = $_.Exception.Message
    Write-Log "Error: $errorMsg"
    exit 1
} 
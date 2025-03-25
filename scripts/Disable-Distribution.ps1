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
        # Get all subscription databases
        $query = @"
        SELECT DISTINCT sub.subscriber_db 
        FROM distribution.dbo.MSsubscriptions sub
        INNER JOIN distribution.dbo.MSarticles art ON sub.article_id = art.article_id
"@
        
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

        # Get all publication databases
        $query = "SELECT DISTINCT publisher_db FROM distribution.dbo.MSpublications"
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
    Write-Log "Removing distribution configuration..."
    if (-not (Remove-DistributionConfiguration -ServerInstance $ServerInstance -DistributionDB $DistributionDB -Force $Force -Credential $SqlCredential)) {
        throw "Failed to remove distribution configuration"
    }

    Write-Log "Successfully disabled publishing and distribution on '$ServerInstance'"
}
catch {
    $errorMsg = $_.Exception.Message
    Write-Log "Error: $errorMsg"
    exit 1
} 
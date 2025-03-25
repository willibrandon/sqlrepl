<#
.SYNOPSIS
    Disables SQL Server replication distributor and removes replication-related configuration.

.DESCRIPTION
    This script performs a complete cleanup of replication configuration by:
    1. Stopping all replication-related SQL Agent jobs
    2. Removing replication from all subscription and publication databases
    3. Dropping the distribution database
    4. Removing the distributor configuration
    
    It supports both local and remote distributor configurations.

.PARAMETER ServerInstance
    The SQL Server instance to remove distributor configuration from.

.PARAMETER DistributionDB
    The name of the distribution database. Default is "distribution".

.PARAMETER Force
    Enables forced cleanup even if some operations fail or some objects cannot be removed.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials if not using Windows Authentication.

.PARAMETER LogToEventLog
    Switch to enable logging to the Windows Event Log.

.PARAMETER LogToSqlTable
    Switch to enable logging to a SQL Server table.

.PARAMETER LoggingServerInstance
    The SQL Server instance for logging if LogToSqlTable is enabled.

.PARAMETER LoggingDatabase
    The database for logging if LogToSqlTable is enabled.

.EXAMPLE
    .\Disable-Distribution.ps1 -ServerInstance "SQLSERVER1\INSTANCE1"
    
    Removes replication configuration from SQL Server instance SQLSERVER1\INSTANCE1.

.EXAMPLE
    .\Disable-Distribution.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -Force
    
    Forces removal of replication configuration, continuing even if errors occur.

.NOTES
    Version: 1.1
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServerInstance,

    [Parameter(Position = 1)]
    [string]$DistributionDB = "distribution",

    [Parameter()]
    [switch]$Force,

    [Parameter()]
    [System.Management.Automation.PSCredential]$SqlCredential,
    
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

function Stop-ReplicationJobs {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Get all replication jobs
        $jobs = Get-ReplicationJobs -ServerInstance $ServerInstance -SqlCredential $SqlCredential
        
        if ($null -eq $jobs -or $jobs.Count -eq 0) {
            Write-Log "No replication jobs found to stop." -Level Info
            return $true
        }
        
        # Stop each job
        foreach ($job in $jobs) {
            if ($PSCmdlet.ShouldProcess("$ServerInstance", "Stop replication job: $($job.name)")) {
                $query = "EXEC msdb.dbo.sp_stop_job @job_name = '$($job.name)'"
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Stopping replication job: $($job.name)" `
                    -LogErrorMessage "Error stopping replication job: $($job.name)"
                
                Write-Log "Stopped replication job: $($job.name)" -Level Info
            }
        }
        return $true
    }
    catch {
        Write-Log "Error stopping replication jobs: $_" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
        if ($Force) {
            Write-Log "Continuing due to -Force switch..." -Level Warning
            return $true
        }
        return $false
    }
}

function Remove-ReplicationFromDatabases {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Check if distribution database exists
        $hasDistribution = Test-DistributionDatabase -ServerInstance $ServerInstance -SqlCredential $SqlCredential
        
        if (-not $hasDistribution) {
            Write-Log "Distribution database not found - skipping replication cleanup from databases" -Level Info
            return $true
        }
        
        # Get subscription databases
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Find subscription databases")) {
            $query = @"
SELECT DISTINCT sub.subscriber_db 
FROM distribution.dbo.MSsubscriptions sub WITH (NOLOCK)
INNER JOIN distribution.dbo.MSarticles art WITH (NOLOCK) ON sub.article_id = art.article_id
WHERE EXISTS (SELECT 1 FROM distribution.dbo.MSsubscriptions)
"@
            
            try {
                $subDatabases = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Finding subscription databases" `
                    -LogErrorMessage "Error finding subscription databases"
                
                # Remove replication from each subscription database
                foreach ($db in $subDatabases) {
                    $query = "EXEC $($db.subscriber_db)..sp_removedbreplication"
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
                        -LogMessage "Removing replication from subscription database: $($db.subscriber_db)" `
                        -LogErrorMessage "Error removing replication from subscription database: $($db.subscriber_db)"
                }
            }
            catch {
                Write-Log "No subscription databases found or error accessing them: $_" -Level Warning
                if (-not $Force) {
                    throw $_
                }
            }
        }
        
        # Get publication databases
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Find publication databases")) {
            $query = @"
SELECT DISTINCT publisher_db 
FROM distribution.dbo.MSpublications WITH (NOLOCK)
WHERE EXISTS (SELECT 1 FROM distribution.dbo.MSpublications)
"@
            
            try {
                $pubDatabases = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Finding publication databases" `
                    -LogErrorMessage "Error finding publication databases"
                
                # Remove replication from each publication database
                foreach ($db in $pubDatabases) {
                    $query = "EXEC $($db.publisher_db)..sp_removedbreplication"
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
                        -LogMessage "Removing replication from publication database: $($db.publisher_db)" `
                        -LogErrorMessage "Error removing replication from publication database: $($db.publisher_db)"
                }
            }
            catch {
                Write-Log "No publication databases found or error accessing them: $_" -Level Warning
                if (-not $Force) {
                    throw $_
                }
            }
        }
        
        return $true
    }
    catch {
        Write-Log "Error removing replication from databases: $_" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
        if ($Force) {
            Write-Log "Continuing due to -Force switch..." -Level Warning
            return $true
        }
        return $false
    }
}

function Remove-DistributionConfiguration {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$DistributionDB,
        [bool]$Force,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Check if server is configured as a distributor
        $isDistributorQuery = @"
IF EXISTS (SELECT 1 FROM master.dbo.sysdatabases WHERE name = 'distribution')
   OR EXISTS (SELECT 1 FROM sys.databases WHERE name = 'distribution')
   OR EXISTS (SELECT 1 FROM master.dbo.sysservers WHERE srvname = @@SERVERNAME AND datasource = @@SERVERNAME AND isremote = 0)
SELECT 1 as IsDistributor
ELSE 
SELECT 0 as IsDistributor
"@
        
        $isDistributor = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $isDistributorQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking if server is configured as a distributor" `
            -LogErrorMessage "Error checking distributor configuration"
        
        if ($isDistributor.IsDistributor -eq 0) {
            Write-Log "Server is not configured as a distributor - no cleanup needed" -Level Info
            return $true
        }
        
        # Remove publisher
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Remove distributor publisher")) {
            $dropPublisherQuery = "EXEC sp_dropdistpublisher @publisher = N'$ServerInstance', @no_checks = $([int]$Force)"
            try {
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropPublisherQuery -SqlCredential $SqlCredential `
                    -LogMessage "Removing publisher: $ServerInstance" `
                    -LogErrorMessage "Error removing publisher"
            }
            catch {
                $errorMsg = $_.Exception.Message
                Write-Log "Could not remove publisher $ServerInstance`: $errorMsg" -Level Warning
                if (-not $Force) {
                    throw $_
                }
            }
        }
        
        # Drop distribution database
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Drop distribution database: $DistributionDB")) {
            $dropDistDbQuery = "EXEC sp_dropdistributiondb @database = N'$DistributionDB'"
            try {
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropDistDbQuery -SqlCredential $SqlCredential `
                    -LogMessage "Dropping distribution database: $DistributionDB" `
                    -LogErrorMessage "Error dropping distribution database"
            }
            catch {
                $errorMsg = $_.Exception.Message
                Write-Log "Could not drop distribution database: $errorMsg" -Level Warning
                if (-not $Force) {
                    throw $_
                }
            }
        }
        
        # Drop distributor
        if ($PSCmdlet.ShouldProcess("$ServerInstance", "Remove distributor configuration")) {
            $dropDistributorQuery = "EXEC sp_dropdistributor @no_checks = 1, @ignore_distributor = 1"
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropDistributorQuery -SqlCredential $SqlCredential `
                -LogMessage "Removing distributor configuration" `
                -LogErrorMessage "Error removing distributor configuration"
            
            Write-Log "Successfully removed distributor configuration" -Level Success
        }
        
        return $true
    }
    catch {
        Write-Log "Error removing distribution configuration: $_" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
        if ($Force) {
            Write-Log "Continuing due to -Force switch..." -Level Warning
            return $true
        }
        return $false
    }
}

# Main script execution
try {
    # Validate SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }
    
    # Get confirmation from user unless -Force is specified
    if (-not $Force -and -not ($PSCmdlet.MyInvocation.BoundParameters["Confirm"] -eq $false)) {
        $title = "Remove Replication Configuration"
        $message = "WARNING: This will remove all replication configuration from $ServerInstance.`nThis action is NOT reversible without reconfiguring replication.`nAre you sure you want to continue?"
        
        $options = [System.Management.Automation.Host.ChoiceDescription[]] @(
            New-Object System.Management.Automation.Host.ChoiceDescription "&Yes", "Remove replication"
            New-Object System.Management.Automation.Host.ChoiceDescription "&No", "Cancel operation"
        )
        
        $result = $host.UI.PromptForChoice($title, $message, $options, 1)
        if ($result -ne 0) {
            Write-Log "Operation cancelled by user." -Level Warning
            exit 0
        }
    }
    
    Write-Log "Starting replication configuration removal on '$ServerInstance'..." -Level Info
    
    # Step 1: Stop all replication jobs
    Write-Log "Stopping replication jobs..." -Level Info
    $jobsStopped = Stop-ReplicationJobs -ServerInstance $ServerInstance -SqlCredential $SqlCredential
    if (-not $jobsStopped -and -not $Force) {
        throw "Failed to stop replication jobs."
    }
    
    # Step 2: Remove replication from databases
    Write-Log "Removing replication from databases..." -Level Info
    $replicationRemoved = Remove-ReplicationFromDatabases -ServerInstance $ServerInstance -SqlCredential $SqlCredential
    if (-not $replicationRemoved -and -not $Force) {
        throw "Failed to remove replication from databases."
    }
    
    # Step 3: Remove distribution configuration
    Write-Log "Removing distribution configuration..." -Level Info
    $distributionRemoved = Remove-DistributionConfiguration -ServerInstance $ServerInstance -DistributionDB $DistributionDB -Force $Force -SqlCredential $SqlCredential
    if (-not $distributionRemoved -and -not $Force) {
        throw "Failed to remove distribution configuration."
    }
    
    Write-Log "Successfully completed replication cleanup on '$ServerInstance'" -Level Success
}
catch {
    Write-Log "Error in Disable-Distribution: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
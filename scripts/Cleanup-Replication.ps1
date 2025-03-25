<#
.SYNOPSIS
    Cleans up SQL Server replication configuration.

.DESCRIPTION
    Provides a comprehensive cleanup of SQL Server replication components including:
    - Removing subscriptions
    - Dropping publications
    - Disabling publishing on databases
    - Removing distributors
    - Cleaning up replication jobs
    - Removing distribution databases
    
    This script can be used to completely remove replication or to clean up failed 
    replication configurations.

.PARAMETER ServerInstance
    The SQL Server instance to clean up.

.PARAMETER CleanupMode
    The type of cleanup to perform: Publications, Subscriptions, Distribution, or Complete.

.PARAMETER PublicationDB
    Optional: The specific publication database to clean up. If not specified, all publication databases are processed.

.PARAMETER PublicationName
    Optional: The specific publication to clean up. If not specified, all publications are processed.

.PARAMETER DistributionDB
    Optional: The name of the distribution database. Default is 'distribution'.

.PARAMETER Force
    Switch to force removal without confirmation prompts.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials for connecting to SQL Server.

.EXAMPLE
    .\Cleanup-Replication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -CleanupMode Complete -Force

    Completely removes all replication configuration from the server instance.

.EXAMPLE
    .\Cleanup-Replication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -CleanupMode Publications -PublicationDB "SalesDB"

    Removes all publications from the SalesDB database.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
    
    WARNING: This script will remove replication configuration. Use with caution in production environments.
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServerInstance,
    
    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateSet("Publications", "Subscriptions", "Distribution", "Complete")]
    [string]$CleanupMode,
    
    [Parameter(Mandatory = $false)]
    [string]$PublicationDB,
    
    [Parameter(Mandatory = $false)]
    [string]$PublicationName,
    
    [Parameter(Mandatory = $false)]
    [string]$DistributionDB = "distribution",
    
    [Parameter(Mandatory = $false)]
    [switch]$Force,
    
    [Parameter(Mandatory = $false)]
    [System.Management.Automation.PSCredential]$SqlCredential,
    
    [Parameter(Mandatory = $false)]
    [switch]$LogToEventLog,
    
    [Parameter(Mandatory = $false)]
    [switch]$LogToSqlTable,
    
    [Parameter(Mandatory = $false)]
    [string]$LoggingServerInstance,
    
    [Parameter(Mandatory = $false)]
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

function Remove-ReplicationJobs {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Build the filter conditions
        $dbFilter = if ($PublicationDB) { "AND (name LIKE '%$PublicationDB%' OR category_name LIKE '%$PublicationDB%')" } else { "" }
        $pubFilter = if ($PublicationName) { "AND (name LIKE '%$PublicationName%' OR category_name LIKE '%$PublicationName%')" } else { "" }
        
        # Get list of replication jobs
        $jobsQuery = @"
SELECT name, job_id
FROM msdb.dbo.sysjobs 
WHERE (name LIKE 'REPL-%' OR category_name = 'REPL-Distribution' OR category_name = 'REPL-LogReader' OR category_name = 'REPL-Merge' OR category_name = 'REPL-QueueReader' OR category_name = 'REPL-Snapshot')
$dbFilter
$pubFilter
"@
        
        $jobs = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $jobsQuery -SqlCredential $SqlCredential `
            -LogMessage "Getting list of replication jobs" `
            -LogErrorMessage "Failed to get replication jobs"
        
        if ($jobs) {
            foreach ($job in $jobs) {
                $stopJobQuery = "EXEC msdb.dbo.sp_stop_job @job_name = N'$($job.name)'"
                $deleteJobQuery = "EXEC msdb.dbo.sp_delete_job @job_id = N'$($job.job_id)', @delete_unused_schedule = 1"
                
                if ($PSCmdlet.ShouldProcess("$ServerInstance - $($job.name)", "Stop and delete replication job")) {
                    # Stop the job first
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $stopJobQuery -SqlCredential $SqlCredential `
                        -LogMessage "Stopping replication job: $($job.name)" `
                        -LogErrorMessage "Failed to stop replication job" -ContinueOnError
                    
                    # Then delete it
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $deleteJobQuery -SqlCredential $SqlCredential `
                        -LogMessage "Deleting replication job: $($job.name)" `
                        -LogErrorMessage "Failed to delete replication job"
                }
            }
            
            Write-Log "Successfully removed $($jobs.Count) replication jobs" -Level Success
            return $true
        }
        else {
            Write-Log "No matching replication jobs found" -Level Info
            return $true
        }
    }
    catch {
        Write-Log "Error removing replication jobs: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Remove-Publications {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $pubDatabases = @()
        
        if ($PublicationDB) {
            $pubDatabases += $PublicationDB
        }
        else {
            # Get all databases with publications
            $dbQuery = @"
SELECT DISTINCT d.name
FROM master.dbo.sysdatabases d
WHERE EXISTS (
    SELECT 1 FROM [$DistributionDB].dbo.MSpublications p
    WHERE p.publisher_db = d.name
    AND p.publisher_id IN (SELECT server_id FROM master.dbo.sysservers WHERE srvname = @@SERVERNAME)
)
OR EXISTS (
    SELECT 1 FROM [$DistributionDB].dbo.MSmerge_publications mp
    WHERE mp.publisher_db = d.name
    AND mp.publisher_id IN (SELECT server_id FROM master.dbo.sysservers WHERE srvname = @@SERVERNAME)
)
"@
            
            $databases = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dbQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting list of databases with publications" `
                -LogErrorMessage "Failed to get databases with publications"
            
            if ($databases) {
                $pubDatabases = $databases | ForEach-Object { $_.name }
            }
        }
        
        foreach ($db in $pubDatabases) {
            $publications = @()
            
            if ($PublicationName) {
                $publications += $PublicationName
            }
            else {
                # Get all publications in this database
                $pubQuery = @"
-- Get transactional/snapshot publications
SELECT name, 'Transactional' AS type
FROM [$db].dbo.syspublications
UNION
-- Get merge publications
SELECT name, 'Merge' AS type
FROM [$db].dbo.sysmergepublications
"@
                
                $pubs = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $pubQuery -SqlCredential $SqlCredential `
                    -LogMessage "Getting list of publications in database $db" `
                    -LogErrorMessage "Failed to get publications"
                
                if ($pubs) {
                    foreach ($pub in $pubs) {
                        $publications += @{
                            Name = $pub.name
                            Type = $pub.type
                        }
                    }
                }
            }
            
            # Process each publication
            foreach ($pub in $publications) {
                $pubName = if ($pub -is [string]) { $pub } else { $pub.Name }
                $pubType = if ($pub -is [string]) { "Unknown" } else { $pub.Type }
                
                # First drop all subscriptions to this publication
                $subQuery = if ($pubType -eq "Merge") {
                    "USE [$db]; EXEC sp_dropmergesubscription @publication = N'$pubName', @subscriber = N'all', @subscriber_db = N'all'"
                } else {
                    "USE [$db]; EXEC sp_dropsubscription @publication = N'$pubName', @article = N'all', @subscriber = N'all'"
                }
                
                if ($PSCmdlet.ShouldProcess("$ServerInstance - $db.$pubName", "Drop subscriptions")) {
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $subQuery -SqlCredential $SqlCredential `
                        -LogMessage "Dropping all subscriptions to publication $db.$pubName" `
                        -LogErrorMessage "Failed to drop subscriptions" -ContinueOnError
                }
                
                # Drop the publication
                $dropPubQuery = if ($pubType -eq "Merge") {
                    "USE [$db]; EXEC sp_dropmergepublication @publication = N'$pubName'"
                } else {
                    "USE [$db]; EXEC sp_droppublication @publication = N'$pubName'"
                }
                
                if ($PSCmdlet.ShouldProcess("$ServerInstance - $db.$pubName", "Drop publication")) {
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropPubQuery -SqlCredential $SqlCredential `
                        -LogMessage "Dropping publication $db.$pubName" `
                        -LogErrorMessage "Failed to drop publication"
                }
                
                Write-Log "Successfully removed publication $db.$pubName" -Level Success
            }
            
            # If we've processed all publications in the database, disable publishing
            if (-not $PublicationName) {
                $disablePubQuery = @"
USE [$db]
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = '$db' AND is_published = 1)
BEGIN
    EXEC sp_replicationdboption @dbname = N'$db', @optname = N'publish', @value = N'false'
END
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = '$db' AND is_merge_published = 1)
BEGIN
    EXEC sp_replicationdboption @dbname = N'$db', @optname = N'merge publish', @value = N'false'
END
"@
                
                if ($PSCmdlet.ShouldProcess("$ServerInstance - $db", "Disable publishing")) {
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $disablePubQuery -SqlCredential $SqlCredential `
                        -LogMessage "Disabling publishing for database $db" `
                        -LogErrorMessage "Failed to disable publishing"
                }
                
                Write-Log "Successfully disabled publishing for database $db" -Level Success
            }
        }
        
        return $true
    }
    catch {
        Write-Log "Error removing publications: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Remove-PullSubscriptions {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Get all databases with pull subscriptions
        $dbQuery = @"
SELECT DISTINCT d.name
FROM master.dbo.sysdatabases d
WHERE EXISTS (
    SELECT 1 FROM msdb.dbo.MSsubscription_properties sp
    JOIN msdb.dbo.MSsubscription_agents sa ON sp.agent_id = sa.id
    WHERE sa.subscriber_db = d.name
)
OR EXISTS (
    SELECT 1 FROM msdb.dbo.MSmerge_subscription_agents msa
    WHERE msa.subscriber_db = d.name
)
"@
        
        $databases = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dbQuery -SqlCredential $SqlCredential `
            -LogMessage "Getting list of databases with pull subscriptions" `
            -LogErrorMessage "Failed to get databases with pull subscriptions"
        
        if ($databases) {
            foreach ($db in $databases) {
                # Get transactional pull subscriptions
                $transSubQuery = @"
SELECT publisher, publisher_db, publication, sa.name AS agent_name, sa.id AS agent_id
FROM msdb.dbo.MSsubscription_properties sp
JOIN msdb.dbo.MSsubscription_agents sa ON sp.agent_id = sa.id
WHERE sa.subscriber_db = '$($db.name)'
"@
                
                $transSubs = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $transSubQuery -SqlCredential $SqlCredential `
                    -LogMessage "Getting transactional pull subscriptions in database $($db.name)" `
                    -LogErrorMessage "Failed to get transactional pull subscriptions" -ContinueOnError
                
                if ($transSubs) {
                    foreach ($sub in $transSubs) {
                        # Drop the pull subscription
                        $dropSubQuery = @"
USE [$($db.name)]
EXEC sp_droppullsubscription 
    @publisher = N'$($sub.publisher)', 
    @publisher_db = N'$($sub.publisher_db)', 
    @publication = N'$($sub.publication)'
"@
                        
                        if ($PSCmdlet.ShouldProcess("$ServerInstance - $($db.name)", "Drop transactional pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)")) {
                            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropSubQuery -SqlCredential $SqlCredential `
                                -LogMessage "Dropping transactional pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)" `
                                -LogErrorMessage "Failed to drop pull subscription"
                        }
                        
                        Write-Log "Successfully removed transactional pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)" -Level Success
                    }
                }
                
                # Get merge pull subscriptions
                $mergeSubQuery = @"
SELECT msa.publisher, msa.publisher_db, msa.publication, msa.name AS agent_name, msa.id AS agent_id
FROM msdb.dbo.MSmerge_subscription_agents msa
WHERE msa.subscriber_db = '$($db.name)'
"@
                
                $mergeSubs = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $mergeSubQuery -SqlCredential $SqlCredential `
                    -LogMessage "Getting merge pull subscriptions in database $($db.name)" `
                    -LogErrorMessage "Failed to get merge pull subscriptions" -ContinueOnError
                
                if ($mergeSubs) {
                    foreach ($sub in $mergeSubs) {
                        # Drop the merge pull subscription
                        $dropMergeSubQuery = @"
USE [$($db.name)]
EXEC sp_dropmergepullsubscription 
    @publisher = N'$($sub.publisher)', 
    @publisher_db = N'$($sub.publisher_db)', 
    @publication = N'$($sub.publication)'
"@
                        
                        if ($PSCmdlet.ShouldProcess("$ServerInstance - $($db.name)", "Drop merge pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)")) {
                            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropMergeSubQuery -SqlCredential $SqlCredential `
                                -LogMessage "Dropping merge pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)" `
                                -LogErrorMessage "Failed to drop merge pull subscription"
                        }
                        
                        Write-Log "Successfully removed merge pull subscription to $($sub.publisher).$($sub.publisher_db).$($sub.publication)" -Level Success
                    }
                }
            }
        }
        else {
            Write-Log "No databases with pull subscriptions found" -Level Info
        }
        
        return $true
    }
    catch {
        Write-Log "Error removing pull subscriptions: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Remove-Distributor {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$DistributionDB,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Check if server is a distributor
        $isDistributorQuery = "EXEC master.sys.sp_get_distributor"
        $distributorInfo = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $isDistributorQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking if server is a distributor" `
            -LogErrorMessage "Failed to check distributor status"
        
        if ($distributorInfo -and $distributorInfo.distributor -ne $null) {
            # Remove the distributor
            $removeDistQuery = @"
-- Remove the distributor
EXEC sp_dropdistributor @no_checks = 1, @ignore_distributor = 1
"@
            
            if ($PSCmdlet.ShouldProcess($ServerInstance, "Remove distributor configuration")) {
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $removeDistQuery -SqlCredential $SqlCredential `
                    -LogMessage "Removing distributor configuration from server $ServerInstance" `
                    -LogErrorMessage "Failed to remove distributor configuration"
            }
            
            Write-Log "Successfully removed distributor configuration from server $ServerInstance" -Level Success
            
            # Drop the distribution database if it exists
            $dropDbQuery = @"
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = '$DistributionDB') 
BEGIN
    ALTER DATABASE [$DistributionDB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE
    DROP DATABASE [$DistributionDB]
END
"@
            
            if ($PSCmdlet.ShouldProcess($ServerInstance, "Drop distribution database $DistributionDB")) {
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dropDbQuery -SqlCredential $SqlCredential `
                    -LogMessage "Dropping distribution database $DistributionDB" `
                    -LogErrorMessage "Failed to drop distribution database"
            }
            
            Write-Log "Successfully dropped distribution database $DistributionDB" -Level Success
        }
        else {
            Write-Log "Server $ServerInstance is not configured as a distributor" -Level Info
        }
        
        return $true
    }
    catch {
        Write-Log "Error removing distributor: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Remove-ReplicationObjects {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Clean up any remaining replication objects
        $cleanupQuery = @"
-- Clean up replication agents in msdb
DELETE FROM msdb.dbo.MSdistribution_agents WHERE 1=1
DELETE FROM msdb.dbo.MSdistribution_history WHERE 1=1
DELETE FROM msdb.dbo.MSdistributor WHERE 1=1
DELETE FROM msdb.dbo.MSrepl_commands WHERE 1=1
DELETE FROM msdb.dbo.MSrepl_errors WHERE 1=1
DELETE FROM msdb.dbo.MSrepl_transactions WHERE 1=1
DELETE FROM msdb.dbo.MSrepl_version WHERE 1=1
DELETE FROM msdb.dbo.MSsnapshot_agents WHERE 1=1
DELETE FROM msdb.dbo.MSsnapshot_history WHERE 1=1
DELETE FROM msdb.dbo.MSlogreader_agents WHERE 1=1
DELETE FROM msdb.dbo.MSlogreader_history WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_agents WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_contents WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_delete_conflicts WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_genhistory WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_history WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_identity_range WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_past_partition_mappings WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_replinfo WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_subscriptions WHERE 1=1
DELETE FROM msdb.dbo.MSmerge_tombstone WHERE 1=1
"@
        
        if ($PSCmdlet.ShouldProcess($ServerInstance, "Clean up residual replication objects")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $cleanupQuery -SqlCredential $SqlCredential `
                -LogMessage "Cleaning up residual replication objects in msdb" `
                -LogErrorMessage "Failed to clean up residual replication objects" -ContinueOnError
        }
        
        return $true
    }
    catch {
        Write-Log "Error cleaning up replication objects: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Cleanup-ReplicationDatabase {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$DatabaseName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Clean up replication markers and objects in the database
        $cleanupQuery = @"
USE [$DatabaseName]

-- Disable replication settings on the database
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = '$DatabaseName' AND (is_published = 1 OR is_merge_published = 1 OR is_distributor = 1))
BEGIN
    -- Disable publishing
    EXEC sp_replicationdboption @dbname = N'$DatabaseName', @optname = N'publish', @value = N'false'
    EXEC sp_replicationdboption @dbname = N'$DatabaseName', @optname = N'merge publish', @value = N'false'
END

-- Clean up any remaining replication markers
EXEC sp_removedbreplication '$DatabaseName'
"@
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance - $DatabaseName", "Clean up replication markers and settings")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $cleanupQuery -SqlCredential $SqlCredential `
                -LogMessage "Cleaning up replication settings in database $DatabaseName" `
                -LogErrorMessage "Failed to clean up replication settings" -ContinueOnError
        }
        
        return $true
    }
    catch {
        Write-Log "Error cleaning up replication database: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

# Main script execution
try {
    # Validate SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }
    
    # Confirmation if not forced
    if (-not $Force -and -not $Confirm) {
        $message = "WARNING: This will remove replication configuration on server '$ServerInstance'"
        
        switch ($CleanupMode) {
            "Publications" { $message += " - All publications" + $(if ($PublicationDB) { " in database '$PublicationDB'" } else { "" }) + $(if ($PublicationName) { " with name '$PublicationName'" } else { "" }) + " will be dropped." }
            "Subscriptions" { $message += " - All subscriptions will be dropped." }
            "Distribution" { $message += " - All distribution configuration will be removed." }
            "Complete" { $message += " - ALL replication configuration will be completely removed." }
        }
        
        $message += "`nAre you sure you want to continue?"
        
        $confirmation = Read-Host -Prompt $message + " (Y/N)"
        if ($confirmation -ne "Y") {
            Write-Log "Operation cancelled by user." -Level Warning
            exit 0
        }
    }
    
    # Perform the requested cleanup
    switch ($CleanupMode) {
        "Publications" {
            Write-Log "Cleaning up publications on server '$ServerInstance'..." -Level Info
            
            if (-not (Remove-Publications -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all publications" -Level Warning
            }
            
            if (-not (Remove-ReplicationJobs -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all replication jobs" -Level Warning
            }
            
            # Cleanup the database if specified
            if ($PublicationDB) {
                if (-not (Cleanup-ReplicationDatabase -ServerInstance $ServerInstance -DatabaseName $PublicationDB -SqlCredential $SqlCredential)) {
                    Write-Log "Failed to clean up replication database $PublicationDB" -Level Warning
                }
            }
        }
        
        "Subscriptions" {
            Write-Log "Cleaning up subscriptions on server '$ServerInstance'..." -Level Info
            
            if (-not (Remove-PullSubscriptions -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all pull subscriptions" -Level Warning
            }
            
            if (-not (Remove-ReplicationJobs -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all replication jobs" -Level Warning
            }
        }
        
        "Distribution" {
            Write-Log "Cleaning up distribution configuration on server '$ServerInstance'..." -Level Info
            
            if (-not (Remove-Distributor -ServerInstance $ServerInstance -DistributionDB $DistributionDB -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove distributor configuration" -Level Warning
            }
            
            if (-not (Remove-ReplicationObjects -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to clean up all replication objects" -Level Warning
            }
        }
        
        "Complete" {
            Write-Log "Performing complete replication cleanup on server '$ServerInstance'..." -Level Info
            
            # First remove publications
            if (-not (Remove-Publications -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all publications" -Level Warning
            }
            
            # Then remove subscriptions
            if (-not (Remove-PullSubscriptions -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all pull subscriptions" -Level Warning
            }
            
            # Remove all replication jobs
            if (-not (Remove-ReplicationJobs -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove all replication jobs" -Level Warning
            }
            
            # Remove the distributor configuration
            if (-not (Remove-Distributor -ServerInstance $ServerInstance -DistributionDB $DistributionDB -SqlCredential $SqlCredential)) {
                Write-Log "Failed to remove distributor configuration" -Level Warning
            }
            
            # Clean up any remaining replication objects
            if (-not (Remove-ReplicationObjects -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
                Write-Log "Failed to clean up all replication objects" -Level Warning
            }
            
            # Get all user databases and clean them up
            $dbQuery = "SELECT name FROM master.sys.databases WHERE database_id > 4"
            $databases = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dbQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting list of user databases" `
                -LogErrorMessage "Failed to get user databases"
            
            if ($databases) {
                foreach ($db in $databases) {
                    if (-not (Cleanup-ReplicationDatabase -ServerInstance $ServerInstance -DatabaseName $db.name -SqlCredential $SqlCredential)) {
                        Write-Log "Failed to clean up replication database $($db.name)" -Level Warning
                    }
                }
            }
        }
    }
    
    Write-Log "Replication cleanup completed successfully" -Level Success
}
catch {
    Write-Log "Error in Cleanup-Replication: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
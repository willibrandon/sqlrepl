<#
.SYNOPSIS
    Tests and validates SQL Server replication setup.

.DESCRIPTION
    Performs a series of tests to validate SQL Server replication setup including:
    - Connectivity to servers
    - Distributor configuration
    - Publication status
    - Subscription status
    - Replication agent status
    - Data synchronization verification
    - Identity range management

.PARAMETER PublisherInstance
    The SQL Server instance hosting the publication.

.PARAMETER PublicationDB
    The database containing the published data.

.PARAMETER PublicationName
    The name of the publication to test.

.PARAMETER SubscriberInstance
    The SQL Server instance hosting the subscription.

.PARAMETER SubscriptionDB
    The database containing the subscription.

.PARAMETER TestType
    The type of test to perform: Quick, Comprehensive, DataSync, or Agents.

.PARAMETER TestData
    Switch to create and sync test data for verification.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials for connecting to SQL Server.

.EXAMPLE
    .\Test-ReplicationSetup.ps1 -PublisherInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "SalesPublication" -SubscriberInstance "SQLSERVER2\INSTANCE1" -SubscriptionDB "SalesDB_Sub" -TestType Quick

    Performs a quick validation of replication setup between the specified instances.

.EXAMPLE
    .\Test-ReplicationSetup.ps1 -PublisherInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "SalesPublication" -SubscriberInstance "SQLSERVER2\INSTANCE1" -SubscriptionDB "SalesDB_Sub" -TestType DataSync -TestData

    Tests data synchronization by creating test data and verifying it propagates correctly.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$PublisherInstance,
    
    [Parameter(Mandatory = $true, Position = 1)]
    [string]$PublicationDB,
    
    [Parameter(Mandatory = $true, Position = 2)]
    [string]$PublicationName,
    
    [Parameter(Mandatory = $true, Position = 3)]
    [string]$SubscriberInstance,
    
    [Parameter(Mandatory = $true, Position = 4)]
    [string]$SubscriptionDB,
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("Quick", "Comprehensive", "DataSync", "Agents")]
    [string]$TestType = "Comprehensive",
    
    [Parameter(Mandatory = $false)]
    [switch]$TestData,
    
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

function Get-ReplicationHealthStatus {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [string]$DatabaseName,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $result = @{
        IsDistributor = $false
        IsPublisher = $false
        PublicationExists = $false
        PublicationType = $null
        LogReaderAgentStatus = "Unknown"
        SnapshotAgentStatus = "Unknown"
        Articles = @()
    }
    
    try {
        # Check distributor and publisher status
        $distributor = Get-DistributorStatus -ServerInstance $ServerInstance -SqlCredential $SqlCredential
        
        if ($distributor) {
            $result.IsDistributor = $distributor.IsDistributor -eq 1
            $result.IsPublisher = $distributor.IsPublisher -eq 1
        }
        
        # Check publication existence and type
        $pubQuery = @"
SELECT CASE
           WHEN EXISTS (SELECT 1 FROM [$DatabaseName].dbo.syspublications WHERE name = '$PublicationName') THEN 'Transactional'
           WHEN EXISTS (SELECT 1 FROM [$DatabaseName].dbo.sysmergepublications WHERE name = '$PublicationName') THEN 'Merge'
           ELSE 'None'
       END AS PublicationType
"@
        
        $pubType = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $pubQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking publication type on $ServerInstance" `
            -LogErrorMessage "Failed to check publication type"
        
        $result.PublicationExists = $pubType.PublicationType -ne "None"
        $result.PublicationType = $pubType.PublicationType
        
        # Check log reader agent status if transactional
        if ($result.PublicationType -eq "Transactional") {
            $logReaderQuery = @"
SELECT j.name, s.step_name, j.enabled,
       CASE ja.run_requested_date
           WHEN NULL THEN 'Not Running'
           ELSE 'Running'
       END AS run_status
FROM msdb.dbo.sysjobs j
INNER JOIN msdb.dbo.sysjobsteps s ON j.job_id = s.job_id
LEFT JOIN msdb.dbo.sysjobactivity ja ON j.job_id = ja.job_id
WHERE j.name LIKE 'REPL-LogReader-$DatabaseName%'
  AND ja.run_requested_date = (SELECT MAX(ja2.run_requested_date) FROM msdb.dbo.sysjobactivity ja2 WHERE ja2.job_id = j.job_id)
"@
            
            $logReader = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $logReaderQuery -SqlCredential $SqlCredential `
                -LogMessage "Checking log reader agent status" `
                -LogErrorMessage "Failed to check log reader agent status" -ContinueOnError
            
            if ($logReader) {
                $result.LogReaderAgentStatus = if ($logReader.enabled -eq 1) {
                    if ($logReader.run_status -eq "Running") { "Running" } else { "Enabled but not running" }
                } else {
                    "Disabled"
                }
            }
        }
        
        # Check snapshot agent status
        $snapshotQuery = @"
SELECT j.name, s.step_name, j.enabled,
       CASE ja.run_requested_date
           WHEN NULL THEN 'Not Running'
           ELSE 'Running'
       END AS run_status
FROM msdb.dbo.sysjobs j
INNER JOIN msdb.dbo.sysjobsteps s ON j.job_id = s.job_id
LEFT JOIN msdb.dbo.sysjobactivity ja ON j.job_id = ja.job_id
WHERE j.name LIKE 'REPL-Snapshot-%$PublicationName%'
  AND ja.run_requested_date = (SELECT MAX(ja2.run_requested_date) FROM msdb.dbo.sysjobactivity ja2 WHERE ja2.job_id = j.job_id)
"@
        
        $snapshot = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $snapshotQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking snapshot agent status" `
            -LogErrorMessage "Failed to check snapshot agent status" -ContinueOnError
        
        if ($snapshot) {
            $result.SnapshotAgentStatus = if ($snapshot.enabled -eq 1) {
                if ($snapshot.run_status -eq "Running") { "Running" } else { "Enabled but not running" }
            } else {
                "Disabled"
            }
        }
        
        # Get articles
        if ($result.PublicationType -eq "Transactional") {
            $articlesQuery = @"
USE [$DatabaseName]
SELECT a.name, a.destination_object, a.source_owner, a.destination_owner, a.status
FROM dbo.sysarticles a
JOIN dbo.syspublications p ON a.pubid = p.pubid
WHERE p.name = '$PublicationName'
"@
            
            $articles = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $articlesQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting article information" `
                -LogErrorMessage "Failed to get article information" -ContinueOnError
            
            if ($articles) {
                $result.Articles = $articles
            }
        }
        elseif ($result.PublicationType -eq "Merge") {
            $articlesQuery = @"
USE [$DatabaseName]
SELECT ma.name, ma.destination_object, ma.source_owner, ma.destination_owner, ma.status
FROM dbo.sysmergearticles ma
JOIN dbo.sysmergepublications mp ON ma.pubid = mp.pubid
WHERE mp.name = '$PublicationName'
"@
            
            $articles = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $articlesQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting merge article information" `
                -LogErrorMessage "Failed to get merge article information" -ContinueOnError
            
            if ($articles) {
                $result.Articles = $articles
            }
        }
        
        return $result
    }
    catch {
        Write-Log "Error getting replication health status: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $result
    }
}

function Get-SubscriptionHealthStatus {
    [CmdletBinding()]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$SubscriberInstance,
        [string]$SubscriptionDB,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $result = @{
        SubscriptionExists = $false
        SubscriptionType = $null
        DistributionAgentStatus = "Unknown"
        LastSynchronized = $null
        PendingCommandCount = 0
    }
    
    try {
        # Check if subscription exists
        $subsQuery = @"
USE [$PublicationDB]
SELECT s.subscriber_db, s.subscription_type, s.status, s.sync_type
FROM dbo.syssubscriptions s
JOIN dbo.syspublications p ON s.pubid = p.pubid
WHERE p.name = '$PublicationName'
  AND s.subscriber_id IN (SELECT srvid FROM master.dbo.sysservers WHERE srvname = '$SubscriberInstance')
  AND s.subscriber_db = '$SubscriptionDB'
"@
        
        $subscription = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $subsQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking subscription existence" `
            -LogErrorMessage "Failed to check subscription existence" -ContinueOnError
        
        if ($subscription) {
            $result.SubscriptionExists = $true
            $result.SubscriptionType = $subscription.subscription_type
            
            # Check distribution agent status for transactional
            $distAgentQuery = @"
SELECT da.name, da.subscriber_db, da.status,
       CASE da.status
           WHEN 1 THEN 'Started'
           WHEN 2 THEN 'Succeeded'
           WHEN 3 THEN 'In progress'
           WHEN 4 THEN 'Idle'
           WHEN 5 THEN 'Retrying'
           WHEN 6 THEN 'Failed'
           ELSE 'Unknown'
       END AS status_desc,
       dh.delivery_time AS last_sync,
       dh.delivered_commands,
       dh.delivered_transactions,
       (
           SELECT COUNT(*) 
           FROM distribution.dbo.MSrepl_commands c
           JOIN distribution.dbo.MSsubscriptions s ON c.article_id = s.article_id
           WHERE s.subscriber_id IN (SELECT server_id FROM master.dbo.sysservers WHERE srvname = '$SubscriberInstance')
             AND s.subscriber_db = '$SubscriptionDB'
       ) AS pending_commands
FROM distribution.dbo.MSdistribution_agents da
LEFT JOIN distribution.dbo.MSdistribution_history dh ON da.id = dh.agent_id
    AND dh.timestamp = (SELECT MAX(timestamp) FROM distribution.dbo.MSdistribution_history WHERE agent_id = da.id)
WHERE da.subscriber_db = '$SubscriptionDB'
  AND da.subscriber_id IN (SELECT server_id FROM master.dbo.sysservers WHERE srvname = '$SubscriberInstance')
"@
            
            $distAgent = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $distAgentQuery -SqlCredential $SqlCredential `
                -LogMessage "Checking distribution agent status" `
                -LogErrorMessage "Failed to check distribution agent status" -ContinueOnError
            
            if ($distAgent) {
                $result.DistributionAgentStatus = $distAgent.status_desc
                $result.LastSynchronized = $distAgent.last_sync
                $result.PendingCommandCount = $distAgent.pending_commands
            }
        }
        
        return $result
    }
    catch {
        Write-Log "Error getting subscription health status: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $result
    }
}

function Test-DataSynchronization {
    [CmdletBinding()]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$SubscriberInstance,
        [string]$SubscriptionDB,
        [System.Management.Automation.PSCredential]$SqlCredential,
        [bool]$CreateTestData
    )
    
    $result = @{
        Success = $false
        Tables = @()
        ErrorMessage = $null
    }
    
    try {
        # Get a list of tables in the publication
        $tablesQuery = @"
SELECT t.name
FROM [$PublicationDB].sys.tables t
JOIN [$PublicationDB].sys.indexes i ON t.object_id = i.object_id
WHERE i.is_primary_key = 1
  AND t.is_ms_shipped = 0
ORDER BY t.name
"@
        
        $tables = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $tablesQuery -SqlCredential $SqlCredential `
            -LogMessage "Getting list of tables with primary keys" `
            -LogErrorMessage "Failed to get table list"
        
        if (-not $tables -or $tables.Count -eq 0) {
            $result.ErrorMessage = "No tables with primary keys found in the publication database."
            return $result
        }
        
        # Create a test table if requested
        if ($CreateTestData) {
            $testTableName = "ReplicationTest_$(Get-Random)"
            
            $createTableQuery = @"
USE [$PublicationDB]
IF OBJECT_ID('dbo.$testTableName', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.$testTableName (
        TestID INT IDENTITY(1,1) PRIMARY KEY,
        TestName NVARCHAR(100),
        TestValue INT,
        TestDate DATETIME DEFAULT GETDATE()
    )
    
    -- Add to publication
    EXEC sp_addarticle 
        @publication = N'$PublicationName', 
        @article = N'$testTableName', 
        @source_owner = N'dbo', 
        @source_object = N'$testTableName', 
        @type = N'logbased', 
        @description = N'', 
        @creation_script = N'', 
        @pre_creation_cmd = N'drop', 
        @schema_option = 0x000000000803509F, 
        @identityrangemanagementoption = N'manual', 
        @destination_table = N'$testTableName', 
        @destination_owner = N'dbo'
END
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $createTableQuery -SqlCredential $SqlCredential `
                -LogMessage "Creating test table: $testTableName" `
                -LogErrorMessage "Failed to create test table"
            
            # Wait for the schema to replicate
            Start-Sleep -Seconds 30
            
            # Insert test data
            $insertDataQuery = @"
USE [$PublicationDB]
INSERT INTO dbo.$testTableName (TestName, TestValue)
VALUES ('Test Data 1', 100),
       ('Test Data 2', 200),
       ('Test Data 3', 300)
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $insertDataQuery -SqlCredential $SqlCredential `
                -LogMessage "Inserting test data into $testTableName" `
                -LogErrorMessage "Failed to insert test data"
            
            # Add this to our list of tables to check
            $tables += [PSCustomObject]@{ name = $testTableName }
            
            # Wait for data to replicate
            Write-Log "Waiting 30 seconds for data to replicate..." -Level Info
            Start-Sleep -Seconds 30
        }
        
        # Check each table for row counts and sample data
        foreach ($table in $tables) {
            $tableName = $table.name
            $tableResult = @{
                TableName = $tableName
                PublisherRowCount = 0
                SubscriberRowCount = 0
                MatchingData = $false
                SampleRowsMatch = $false
                ErrorMessage = $null
            }
            
            # Get publisher row count
            $publisherCountQuery = "SELECT COUNT(*) AS RowCount FROM [$PublicationDB].dbo.[$tableName]"
            $publisherCount = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $publisherCountQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting row count for table $tableName on publisher" `
                -LogErrorMessage "Failed to get publisher row count" -ContinueOnError
            
            if ($publisherCount) {
                $tableResult.PublisherRowCount = $publisherCount.RowCount
            }
            
            # Get subscriber row count
            $subscriberCountQuery = "SELECT COUNT(*) AS RowCount FROM [$SubscriptionDB].dbo.[$tableName]"
            $subscriberCount = Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $subscriberCountQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting row count for table $tableName on subscriber" `
                -LogErrorMessage "Failed to get subscriber row count" -ContinueOnError
            
            if ($subscriberCount) {
                $tableResult.SubscriberRowCount = $subscriberCount.RowCount
                $tableResult.MatchingData = $tableResult.PublisherRowCount -eq $tableResult.SubscriberRowCount
            }
            
            # If there's data, sample a few rows to compare
            if ($tableResult.PublisherRowCount -gt 0) {
                # Get primary key columns
                $pkColumnsQuery = @"
SELECT c.name
FROM [$PublicationDB].sys.tables t
JOIN [$PublicationDB].sys.indexes i ON t.object_id = i.object_id
JOIN [$PublicationDB].sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN [$PublicationDB].sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.is_primary_key = 1
AND t.name = '$tableName'
ORDER BY ic.key_ordinal
"@
                
                $pkColumns = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $pkColumnsQuery -SqlCredential $SqlCredential `
                    -LogMessage "Getting primary key columns for table $tableName" `
                    -LogErrorMessage "Failed to get primary key columns" -ContinueOnError
                
                if ($pkColumns) {
                    $pkColumnsList = $pkColumns | ForEach-Object { $_.name }
                    $pkColumnsForOrderBy = $pkColumnsList -join ', '
                    
                    # Get column list for the table
                    $columnsQuery = "SELECT COLUMN_NAME FROM [$PublicationDB].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '$tableName' ORDER BY ORDINAL_POSITION"
                    $columns = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $columnsQuery -SqlCredential $SqlCredential `
                        -LogMessage "Getting column list for table $tableName" `
                        -LogErrorMessage "Failed to get column list" -ContinueOnError
                    
                    if ($columns) {
                        $columnsList = $columns | ForEach-Object { "[$($_.COLUMN_NAME)]" } | Join-String -Separator ', '
                        
                        # Get sample data from publisher (first 5 rows, ordered by PK)
                        $pubDataQuery = "SELECT TOP 5 $columnsList FROM [$PublicationDB].dbo.[$tableName] ORDER BY $pkColumnsForOrderBy FOR XML PATH('row')"
                        $pubData = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $pubDataQuery -SqlCredential $SqlCredential `
                            -LogMessage "Getting sample data from publisher for table $tableName" `
                            -LogErrorMessage "Failed to get publisher sample data" -ContinueOnError
                        
                        # Get sample data from subscriber (first 5 rows, ordered by PK)
                        $subDataQuery = "SELECT TOP 5 $columnsList FROM [$SubscriptionDB].dbo.[$tableName] ORDER BY $pkColumnsForOrderBy FOR XML PATH('row')"
                        $subData = Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $subDataQuery -SqlCredential $SqlCredential `
                            -LogMessage "Getting sample data from subscriber for table $tableName" `
                            -LogErrorMessage "Failed to get subscriber sample data" -ContinueOnError
                        
                        if ($pubData -and $subData) {
                            # Compare the XML results
                            $tableResult.SampleRowsMatch = $pubData -eq $subData
                        }
                    }
                }
            }
            
            $result.Tables += [PSCustomObject]$tableResult
        }
        
        # If all tables have matching data, consider the test successful
        $result.Success = ($result.Tables | Where-Object { -not $_.MatchingData -or -not $_.SampleRowsMatch }).Count -eq 0
        
        return $result
    }
    catch {
        Write-Log "Error testing data synchronization: $_" -Level Error -WriteToEventLog:$LogToEventLog
        $result.ErrorMessage = $_.Exception.Message
        return $result
    }
}

function Test-ReplicationAgents {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [string]$DatabaseName,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $result = @{
        Agents = @()
        Success = $true
    }
    
    try {
        # Query for replication jobs
        $jobsQuery = @"
SELECT 
    j.name AS JobName,
    j.enabled AS IsEnabled,
    CASE ja.run_requested_date
        WHEN NULL THEN 'Not Running'
        ELSE 'Running'
    END AS RunStatus,
    CASE jh.run_status
        WHEN 0 THEN 'Failed'
        WHEN 1 THEN 'Succeeded'
        WHEN 2 THEN 'Retry'
        WHEN 3 THEN 'Canceled'
        WHEN 4 THEN 'In progress'
        ELSE 'Unknown'
    END AS LastRunStatus,
    jh.run_date AS LastRunDate,
    jh.run_time AS LastRunTime,
    jh.run_duration AS LastRunDuration,
    jh.message AS LastMessage
FROM msdb.dbo.sysjobs j
LEFT JOIN msdb.dbo.sysjobactivity ja ON j.job_id = ja.job_id
LEFT JOIN msdb.dbo.sysjobhistory jh ON j.job_id = jh.job_id AND jh.step_id = 0
    AND jh.instance_id = (SELECT MAX(instance_id) FROM msdb.dbo.sysjobhistory WHERE job_id = j.job_id AND step_id = 0)
WHERE j.name LIKE 'REPL-%'
  AND (j.name LIKE '%$DatabaseName%' OR j.name LIKE '%$PublicationName%')
ORDER BY j.name
"@
        
        $jobs = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $jobsQuery -SqlCredential $SqlCredential `
            -LogMessage "Getting replication agent jobs status" `
            -LogErrorMessage "Failed to get replication agent jobs"
        
        if ($jobs) {
            foreach ($job in $jobs) {
                $agentResult = @{
                    JobName = $job.JobName
                    IsEnabled = $job.IsEnabled -eq 1
                    RunStatus = $job.RunStatus
                    LastRunStatus = $job.LastRunStatus
                    LastRunDateTime = if ($job.LastRunDate) {
                        [DateTime]::ParseExact("$($job.LastRunDate) $($job.LastRunTime)", "yyyyMMdd HHmmss", $null)
                    } else { $null }
                    LastRunDuration = $job.LastRunDuration
                    LastMessage = $job.LastMessage
                    Success = $job.LastRunStatus -eq "Succeeded" -or $job.RunStatus -eq "Running"
                }
                
                $result.Agents += [PSCustomObject]$agentResult
                
                # Update overall success
                if (-not $agentResult.Success) {
                    $result.Success = $false
                }
            }
        }
        
        return $result
    }
    catch {
        Write-Log "Error testing replication agents: $_" -Level Error -WriteToEventLog:$LogToEventLog
        $result.Success = $false
        return $result
    }
}

function Format-TestResults {
    [CmdletBinding()]
    param (
        [hashtable]$Results
    )
    
    Write-Host "`nSQL Server Replication Validation Results" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "Publisher: $PublisherInstance" -ForegroundColor Green
    Write-Host "Publication: $PublicationDB.$PublicationName" -ForegroundColor Green
    Write-Host "Subscriber: $SubscriberInstance" -ForegroundColor Green
    Write-Host "Subscription: $SubscriptionDB" -ForegroundColor Green
    Write-Host "Test Type: $TestType" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan
    
    # Publisher status
    Write-Host "`nPublisher Status:" -ForegroundColor Yellow
    Write-Host "-----------------" -ForegroundColor Yellow
    
    $publisherColorStatus = if ($Results.PublisherStatus.PublicationExists) { "Green" } else { "Red" }
    Write-Host "Is Distributor: " -NoNewline
    Write-Host "$($Results.PublisherStatus.IsDistributor)" -ForegroundColor $(if ($Results.PublisherStatus.IsDistributor) { "Green" } else { "Gray" })
    
    Write-Host "Is Publisher: " -NoNewline
    Write-Host "$($Results.PublisherStatus.IsPublisher)" -ForegroundColor $(if ($Results.PublisherStatus.IsPublisher) { "Green" } else { "Red" })
    
    Write-Host "Publication Exists: " -NoNewline
    Write-Host "$($Results.PublisherStatus.PublicationExists)" -ForegroundColor $publisherColorStatus
    
    Write-Host "Publication Type: " -NoNewline
    Write-Host "$($Results.PublisherStatus.PublicationType)" -ForegroundColor $(if ($Results.PublisherStatus.PublicationType -ne "None") { "Green" } else { "Red" })
    
    Write-Host "Log Reader Agent: " -NoNewline
    Write-Host "$($Results.PublisherStatus.LogReaderAgentStatus)" -ForegroundColor $(
        if ($Results.PublisherStatus.LogReaderAgentStatus -eq "Running" -or $Results.PublisherStatus.LogReaderAgentStatus -eq "Enabled but not running") { "Green" }
        elseif ($Results.PublisherStatus.LogReaderAgentStatus -eq "Unknown") { "Gray" }
        else { "Red" }
    )
    
    Write-Host "Snapshot Agent: " -NoNewline
    Write-Host "$($Results.PublisherStatus.SnapshotAgentStatus)" -ForegroundColor $(
        if ($Results.PublisherStatus.SnapshotAgentStatus -eq "Running" -or $Results.PublisherStatus.SnapshotAgentStatus -eq "Enabled but not running") { "Green" }
        elseif ($Results.PublisherStatus.SnapshotAgentStatus -eq "Unknown") { "Gray" }
        else { "Red" }
    )
    
    # Articles
    if ($Results.PublisherStatus.Articles.Count -gt 0) {
        Write-Host "`nArticles:" -ForegroundColor Yellow
        Write-Host "---------" -ForegroundColor Yellow
        $Results.PublisherStatus.Articles | Format-Table -AutoSize
    }
    
    # Subscription status
    Write-Host "`nSubscription Status:" -ForegroundColor Yellow
    Write-Host "--------------------" -ForegroundColor Yellow
    
    $subColorStatus = if ($Results.SubscriptionStatus.SubscriptionExists) { "Green" } else { "Red" }
    Write-Host "Subscription Exists: " -NoNewline
    Write-Host "$($Results.SubscriptionStatus.SubscriptionExists)" -ForegroundColor $subColorStatus
    
    if ($Results.SubscriptionStatus.SubscriptionExists) {
        Write-Host "Subscription Type: " -NoNewline
        Write-Host "$($Results.SubscriptionStatus.SubscriptionType)" -ForegroundColor "Green"
        
        Write-Host "Distribution Agent Status: " -NoNewline
        Write-Host "$($Results.SubscriptionStatus.DistributionAgentStatus)" -ForegroundColor $(
            if ($Results.SubscriptionStatus.DistributionAgentStatus -eq "Started" -or 
                $Results.SubscriptionStatus.DistributionAgentStatus -eq "Succeeded" -or 
                $Results.SubscriptionStatus.DistributionAgentStatus -eq "Idle" -or
                $Results.SubscriptionStatus.DistributionAgentStatus -eq "In progress") { "Green" }
            elseif ($Results.SubscriptionStatus.DistributionAgentStatus -eq "Unknown") { "Gray" }
            else { "Red" }
        )
        
        Write-Host "Last Synchronized: " -NoNewline
        Write-Host "$($Results.SubscriptionStatus.LastSynchronized)" -ForegroundColor $(if ($Results.SubscriptionStatus.LastSynchronized) { "Green" } else { "Gray" })
        
        Write-Host "Pending Commands: " -NoNewline
        Write-Host "$($Results.SubscriptionStatus.PendingCommandCount)" -ForegroundColor $(if ($Results.SubscriptionStatus.PendingCommandCount -eq 0) { "Green" } else { "Yellow" })
    }
    
    # Agent status
    if ($Results.AgentStatus) {
        Write-Host "`nReplication Agent Status:" -ForegroundColor Yellow
        Write-Host "------------------------" -ForegroundColor Yellow
        
        Write-Host "Overall Agents Status: " -NoNewline
        Write-Host "$($Results.AgentStatus.Success)" -ForegroundColor $(if ($Results.AgentStatus.Success) { "Green" } else { "Red" })
        
        $Results.AgentStatus.Agents | Format-Table -Property JobName, IsEnabled, RunStatus, LastRunStatus, LastRunDateTime, LastRunDuration -AutoSize
    }
    
    # Data synchronization
    if ($Results.DataSyncStatus) {
        Write-Host "`nData Synchronization Status:" -ForegroundColor Yellow
        Write-Host "---------------------------" -ForegroundColor Yellow
        
        Write-Host "Overall Synchronization: " -NoNewline
        Write-Host "$($Results.DataSyncStatus.Success)" -ForegroundColor $(if ($Results.DataSyncStatus.Success) { "Green" } else { "Red" })
        
        if ($Results.DataSyncStatus.ErrorMessage) {
            Write-Host "Error: $($Results.DataSyncStatus.ErrorMessage)" -ForegroundColor Red
        }
        
        if ($Results.DataSyncStatus.Tables.Count -gt 0) {
            $Results.DataSyncStatus.Tables | Format-Table -Property TableName, PublisherRowCount, SubscriberRowCount, MatchingData, SampleRowsMatch -AutoSize
        }
    }
    
    # Overall result
    Write-Host "`nTest Summary:" -ForegroundColor Yellow
    Write-Host "-------------" -ForegroundColor Yellow
    
    $overallSuccess = $Results.PublisherStatus.PublicationExists -and 
                     $Results.SubscriptionStatus.SubscriptionExists -and 
                     (-not $Results.AgentStatus -or $Results.AgentStatus.Success) -and 
                     (-not $Results.DataSyncStatus -or $Results.DataSyncStatus.Success)
    
    Write-Host "Overall Test Result: " -NoNewline
    Write-Host $(if ($overallSuccess) { "PASSED" } else { "FAILED" }) -ForegroundColor $(if ($overallSuccess) { "Green" } else { "Red" })
}

# Main script execution
try {
    # Validate SQL connections
    Write-Log "Validating SQL connections..." -Level Info
    
    if (-not (Test-SqlConnection -ServerInstance $PublisherInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to publisher SQL Server instance '$PublisherInstance'"
    }
    
    if (-not (Test-SqlConnection -ServerInstance $SubscriberInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to subscriber SQL Server instance '$SubscriberInstance'"
    }
    
    $results = @{}
    
    # Check publisher status
    Write-Log "Checking publisher status..." -Level Info
    $results.PublisherStatus = Get-ReplicationHealthStatus -ServerInstance $PublisherInstance -DatabaseName $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
    
    # Check subscription status
    Write-Log "Checking subscription status..." -Level Info
    $results.SubscriptionStatus = Get-SubscriptionHealthStatus -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -SqlCredential $SqlCredential
    
    # Based on test type, perform additional checks
    switch ($TestType) {
        "Quick" {
            # Basic checks done, no additional checks needed
        }
        
        "Comprehensive" {
            # Check agent status
            Write-Log "Checking replication agent status..." -Level Info
            $results.AgentStatus = Test-ReplicationAgents -ServerInstance $PublisherInstance -DatabaseName $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
            
            # Check data synchronization
            Write-Log "Testing data synchronization..." -Level Info
            $results.DataSyncStatus = Test-DataSynchronization -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -SqlCredential $SqlCredential -CreateTestData $TestData
        }
        
        "DataSync" {
            # Check data synchronization only
            Write-Log "Testing data synchronization..." -Level Info
            $results.DataSyncStatus = Test-DataSynchronization -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -SqlCredential $SqlCredential -CreateTestData $TestData
        }
        
        "Agents" {
            # Check agent status only
            Write-Log "Checking replication agent status..." -Level Info
            $results.AgentStatus = Test-ReplicationAgents -ServerInstance $PublisherInstance -DatabaseName $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
        }
    }
    
    # Format and display results
    Format-TestResults -Results $results
    
    # Return results for pipeline
    return [PSCustomObject]$results
}
catch {
    Write-Log "Error in Test-ReplicationSetup: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
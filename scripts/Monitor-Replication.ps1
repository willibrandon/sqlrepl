<#
.SYNOPSIS
    Monitors SQL Server replication processes and components.

.DESCRIPTION
    Provides comprehensive monitoring of SQL Server replication components including:
    - Distributor status
    - Publication health
    - Subscription synchronization status
    - Replication agent job history and status
    - Error detection and alerting

.PARAMETER ServerInstance
    The SQL Server instance to monitor.

.PARAMETER PublicationDB
    Optional: The specific publication database to monitor. If not specified, all publication databases are monitored.

.PARAMETER SubscriptionDB
    Optional: The specific subscription database to monitor. If not specified, all subscription databases are monitored.

.PARAMETER PublicationName
    Optional: The specific publication to monitor. If not specified, all publications are monitored.

.PARAMETER MonitorType
    The type of monitoring to perform: AgentStatus, LatencyCheck, ErrorOnly, or Comprehensive.

.PARAMETER OutputFormat
    The format of the output: Console, Html, GridView, Json, or Csv.

.PARAMETER OutputPath
    The file path where the output should be saved if using Html, Json, or Csv format.

.PARAMETER AlertThreshold
    The threshold in minutes that triggers an alert for replication latency.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials for connecting to SQL Server.

.EXAMPLE
    .\Monitor-Replication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -MonitorType Comprehensive -OutputFormat Console

    Performs comprehensive monitoring of all replication components on SQLSERVER1\INSTANCE1 and outputs results to the console.

.EXAMPLE
    .\Monitor-Replication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -MonitorType LatencyCheck -AlertThreshold 15 -OutputFormat Html -OutputPath "C:\Reports\ReplicationStatus.html"

    Monitors replication latency for publications in the SalesDB database, alerting if latency exceeds 15 minutes, and outputs an HTML report.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServerInstance,
    
    [Parameter(Mandatory = $false)]
    [string]$PublicationDB,
    
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionDB,
    
    [Parameter(Mandatory = $false)]
    [string]$PublicationName,
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("AgentStatus", "LatencyCheck", "ErrorOnly", "Comprehensive")]
    [string]$MonitorType = "Comprehensive",
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("Console", "Html", "GridView", "Json", "Csv")]
    [string]$OutputFormat = "Console",
    
    [Parameter(Mandatory = $false)]
    [string]$OutputPath,
    
    [Parameter(Mandatory = $false)]
    [int]$AlertThreshold = 30,
    
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

function Get-DistributorStatus {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = @"
EXEC master.sys.sp_get_distributor;
SELECT @@SERVERNAME AS ServerName,
       is_distributor AS IsDistributor,
       is_publisher AS IsPublisher,
       is_subscriber AS IsSubscriber,
       is_publisher_and_distributor AS IsPublisherAndDistributor,
       is_installed AS IsReplicationInstalled
FROM sys.servers s
JOIN master.dbo.MSreplmonthresholds t ON 1=1
WHERE server_id = 0;
"@
        
        $result = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
            -LogMessage "Checking distributor status on '$ServerInstance'" `
            -LogErrorMessage "Failed to check distributor status"
        
        return $result
    }
    catch {
        Write-Log "Error checking distributor status: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Get-PublicationStatus {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $dbFilter = if ($PublicationDB) { "AND d.name = '$PublicationDB'" } else { "" }
        $pubFilter = if ($PublicationName) { "AND p.name = '$PublicationName'" } else { "" }
        
        # First check for transactional/snapshot publications
        $tranQuery = @"
SELECT d.name AS DatabaseName,
       p.name AS PublicationName,
       p.publication_id AS PublicationID,
       p.publication_type AS PublicationType,
       CASE p.publication_type
           WHEN 0 THEN 'Transactional'
           WHEN 1 THEN 'Snapshot'
           WHEN 2 THEN 'Merge'
           ELSE 'Unknown'
       END AS PublicationTypeName,
       p.immediate_sync AS ImmediateSync,
       p.allow_pull AS AllowPull,
       p.allow_push AS AllowPush,
       p.allow_anonymous AS AllowAnonymous,
       p.immediate_sync AS ImmediateSync,
       p.enabled_for_internet AS EnabledForInternet,
       a.name AS SnapshotAgentName,
       a.id AS SnapshotAgentID,
       CASE a.status
           WHEN 1 THEN 'Started'
           WHEN 2 THEN 'Succeeded'
           WHEN 3 THEN 'In Progress'
           WHEN 4 THEN 'Idle'
           WHEN 5 THEN 'Retrying'
           WHEN 6 THEN 'Failed'
           ELSE 'Unknown'
       END AS SnapshotAgentStatus,
       a.last_run_date AS LastSnapshotDate
FROM master.dbo.sysdatabases d
JOIN msdb.dbo.MSdistpublishers dp ON dp.publisher = @@SERVERNAME
JOIN msdb.dbo.MSdistpublications p ON p.publisher_id = dp.id AND p.publisher_db = d.name
LEFT JOIN msdb.dbo.MSdistribution_agents a ON a.publication_id = p.publication_id AND a.publisher_db = d.name
WHERE EXISTS (SELECT 1 FROM master.sys.databases WHERE name = 'distribution')
$dbFilter
$pubFilter
"@
        
        $tranPublications = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $tranQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking transactional/snapshot publication status" `
            -LogErrorMessage "Failed to check transactional/snapshot publication status"
        
        # Now check for merge publications if they exist
        $mergeQuery = @"
SELECT db.name AS DatabaseName,
       mp.name AS PublicationName,
       mp.publication_id AS PublicationID,
       'Merge' AS PublicationTypeName,
       mp.description AS Description,
       mp.retention AS RetentionPeriod,
       mp.allow_pull AS AllowPull,
       mp.allow_push AS AllowPush,
       mp.allow_anonymous AS AllowAnonymous,
       ma.name AS SnapshotAgentName,
       ma.id AS SnapshotAgentID,
       CASE ma.status
           WHEN 1 THEN 'Started'
           WHEN 2 THEN 'Succeeded'
           WHEN 3 THEN 'In Progress'
           WHEN 4 THEN 'Idle'
           WHEN 5 THEN 'Retrying'
           WHEN 6 THEN 'Failed'
           ELSE 'Unknown'
       END AS SnapshotAgentStatus,
       ma.last_run_date AS LastSnapshotDate
FROM master.dbo.sysdatabases db
JOIN msdb.dbo.MSmerge_agents ma ON ma.publisher_db = db.name
JOIN msdb.dbo.MSmerge_publications mp ON mp.publisher_db = db.name AND mp.publication = ma.publication
WHERE ma.subscriber_id = 0 AND ma.publisher = @@SERVERNAME
$dbFilter
$pubFilter
"@
        
        $mergePublications = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $mergeQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking merge publication status" `
            -LogErrorMessage "Failed to check merge publication status" -ContinueOnError
        
        # Return both sets of results
        return @{
            TransactionalPublications = $tranPublications
            MergePublications = $mergePublications
        }
    }
    catch {
        Write-Log "Error checking publication status: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Get-SubscriptionStatus {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$SubscriptionDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $dbFilter = if ($PublicationDB) { "AND da.publisher_db = '$PublicationDB'" } else { "" }
        $subDbFilter = if ($SubscriptionDB) { "AND da.subscriber_db = '$SubscriptionDB'" } else { "" }
        $pubFilter = if ($PublicationName) { "AND da.publication = '$PublicationName'" } else { "" }
        
        # Query for transactional/snapshot subscriptions
        $tranQuery = @"
SELECT da.publisher AS PublisherServer,
       da.publisher_db AS PublisherDB,
       da.publication AS PublicationName,
       da.subscriber AS SubscriberServer,
       da.subscriber_db AS SubscriberDB,
       CASE da.subscription_type
           WHEN 0 THEN 'Push'
           WHEN 1 THEN 'Pull'
           ELSE 'Unknown'
       END AS SubscriptionType,
       da.name AS AgentName,
       CASE da.status
           WHEN 1 THEN 'Started'
           WHEN 2 THEN 'Succeeded'
           WHEN 3 THEN 'In Progress'
           WHEN 4 THEN 'Idle'
           WHEN 5 THEN 'Retrying'
           WHEN 6 THEN 'Failed'
           ELSE 'Unknown'
       END AS AgentStatus,
       da.last_run_date AS LastRunDate,
       dh.runstatus AS RunStatus,
       dh.start_time AS LastStartTime,
       dh.duration AS LastDurationSeconds,
       dh.comments AS LastComments,
       dh.error_id AS LastErrorID,
       DATEDIFF(MINUTE, dh.start_time, GETDATE()) AS MinutesSinceLastSync,
       CASE 
           WHEN DATEDIFF(MINUTE, dh.start_time, GETDATE()) > $AlertThreshold THEN 'Alert'
           ELSE 'OK'
       END AS LatencyStatus
FROM msdb.dbo.MSdistribution_agents da
LEFT JOIN msdb.dbo.MSdistribution_history dh ON dh.agent_id = da.id
    AND dh.runstatus = (SELECT MAX(runstatus) FROM msdb.dbo.MSdistribution_history WHERE agent_id = da.id)
WHERE da.subscriber IS NOT NULL
$dbFilter
$subDbFilter
$pubFilter
ORDER BY da.publisher_db, da.publication, da.subscriber, da.subscriber_db
"@
        
        $tranSubscriptions = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $tranQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking transactional/snapshot subscription status" `
            -LogErrorMessage "Failed to check transactional/snapshot subscription status"
        
        # Query for merge subscriptions
        $mergeQuery = @"
SELECT ma.publisher AS PublisherServer,
       ma.publisher_db AS PublisherDB,
       ma.publication AS PublicationName,
       ma.subscriber AS SubscriberServer,
       ma.subscriber_db AS SubscriberDB,
       CASE ma.subscription_type
           WHEN 0 THEN 'Push'
           WHEN 1 THEN 'Pull'
           WHEN 2 THEN 'Anonymous'
           ELSE 'Unknown'
       END AS SubscriptionType,
       ma.name AS AgentName,
       CASE ma.status
           WHEN 1 THEN 'Started'
           WHEN 2 THEN 'Succeeded'
           WHEN 3 THEN 'In Progress'
           WHEN 4 THEN 'Idle'
           WHEN 5 THEN 'Retrying'
           WHEN 6 THEN 'Failed'
           ELSE 'Unknown'
       END AS AgentStatus,
       ma.last_run_date AS LastRunDate,
       mh.runstatus AS RunStatus,
       mh.start_time AS LastStartTime,
       mh.duration AS LastDurationSeconds,
       mh.comments AS LastComments,
       mh.error_id AS LastErrorID,
       DATEDIFF(MINUTE, mh.start_time, GETDATE()) AS MinutesSinceLastSync,
       CASE 
           WHEN DATEDIFF(MINUTE, mh.start_time, GETDATE()) > $AlertThreshold THEN 'Alert'
           ELSE 'OK'
       END AS LatencyStatus
FROM msdb.dbo.MSmerge_agents ma
LEFT JOIN msdb.dbo.MSmerge_history mh ON mh.agent_id = ma.id
    AND mh.runstatus = (SELECT MAX(runstatus) FROM msdb.dbo.MSmerge_history WHERE agent_id = ma.id)
WHERE ma.subscriber_id <> 0
$dbFilter
$subDbFilter
$pubFilter
ORDER BY ma.publisher_db, ma.publication, ma.subscriber, ma.subscriber_db
"@
        
        $mergeSubscriptions = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $mergeQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking merge subscription status" `
            -LogErrorMessage "Failed to check merge subscription status" -ContinueOnError
        
        return @{
            TransactionalSubscriptions = $tranSubscriptions
            MergeSubscriptions = $mergeSubscriptions
        }
    }
    catch {
        Write-Log "Error checking subscription status: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Get-ReplicationErrors {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [int]$Hours = 24,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = @"
-- Distribution agent errors
SELECT 'Distribution' AS AgentType,
       da.name AS AgentName,
       da.publisher_db AS PublisherDB,
       da.publication AS Publication,
       da.subscriber AS Subscriber,
       da.subscriber_db AS SubscriberDB,
       dh.time AS ErrorTime,
       dh.comments AS ErrorMessage,
       dh.error_id AS ErrorID
FROM msdb.dbo.MSdistribution_agents da
JOIN msdb.dbo.MSdistribution_history dh ON dh.agent_id = da.id
WHERE dh.error_id <> 0
AND dh.time > DATEADD(HOUR, -$Hours, GETDATE())

UNION ALL

-- Snapshot agent errors
SELECT 'Snapshot' AS AgentType,
       sa.name AS AgentName,
       sa.publisher_db AS PublisherDB,
       sa.publication AS Publication,
       NULL AS Subscriber,
       NULL AS SubscriberDB,
       sh.time AS ErrorTime,
       sh.comments AS ErrorMessage,
       sh.error_id AS ErrorID
FROM msdb.dbo.MSsnapshot_agents sa
JOIN msdb.dbo.MSsnapshot_history sh ON sh.agent_id = sa.id
WHERE sh.error_id <> 0
AND sh.time > DATEADD(HOUR, -$Hours, GETDATE())

UNION ALL

-- Merge agent errors
SELECT 'Merge' AS AgentType,
       ma.name AS AgentName,
       ma.publisher_db AS PublisherDB,
       ma.publication AS Publication,
       ma.subscriber AS Subscriber,
       ma.subscriber_db AS SubscriberDB,
       mh.time AS ErrorTime,
       mh.comments AS ErrorMessage,
       mh.error_id AS ErrorID
FROM msdb.dbo.MSmerge_agents ma
JOIN msdb.dbo.MSmerge_history mh ON mh.agent_id = ma.id
WHERE mh.error_id <> 0
AND mh.time > DATEADD(HOUR, -$Hours, GETDATE())
ORDER BY ErrorTime DESC
"@
        
        $result = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
            -LogMessage "Checking replication errors in the last $Hours hours" `
            -LogErrorMessage "Failed to check replication errors"
        
        return $result
    }
    catch {
        Write-Log "Error checking replication errors: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Get-ReplicationPerformanceMetrics {
    [CmdletBinding()]
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = @"
-- Distribution latency and throughput
SELECT da.name AS AgentName,
       da.publisher_db AS PublisherDB,
       da.publication AS Publication,
       da.subscriber AS Subscriber,
       da.subscriber_db AS SubscriberDB,
       MAX(dh.delivery_time) AS LastDeliveryTime,
       AVG(dh.delivered_transactions) AS AvgTransactionsDelivered,
       MAX(dh.delivered_commands) AS MaxCommandsDelivered,
       AVG(dh.delivery_latency) AS AvgDeliveryLatencySeconds,
       MAX(dh.delivery_latency) AS MaxDeliveryLatencySeconds,
       AVG(dh.delivery_rate) AS AvgDeliveryRate,
       MAX(dh.delivery_rate) AS MaxDeliveryRate,
       AVG(dh.total_delivered_commands) AS AvgTotalDeliveredCommands
FROM msdb.dbo.MSdistribution_agents da
JOIN msdb.dbo.MSdistribution_history dh ON dh.agent_id = da.id
WHERE dh.time > DATEADD(DAY, -1, GETDATE()) -- Last 24 hours
GROUP BY da.name, da.publisher_db, da.publication, da.subscriber, da.subscriber_db

UNION ALL

-- Merge performance metrics
SELECT ma.name AS AgentName,
       ma.publisher_db AS PublisherDB,
       ma.publication AS Publication,
       ma.subscriber AS Subscriber,
       ma.subscriber_db AS SubscriberDB,
       MAX(mh.time) AS LastDeliveryTime,
       AVG(mh.delivered_transactions) AS AvgTransactionsDelivered,
       MAX(mh.delivered_commands) AS MaxCommandsDelivered,
       NULL AS AvgDeliveryLatencySeconds,
       NULL AS MaxDeliveryLatencySeconds,
       AVG(mh.delivery_rate) AS AvgDeliveryRate,
       MAX(mh.delivery_rate) AS MaxDeliveryRate,
       AVG(mh.total_delivered_commands) AS AvgTotalDeliveredCommands
FROM msdb.dbo.MSmerge_agents ma
JOIN msdb.dbo.MSmerge_history mh ON mh.agent_id = ma.id
WHERE mh.time > DATEADD(DAY, -1, GETDATE()) -- Last 24 hours
GROUP BY ma.name, ma.publisher_db, ma.publication, ma.subscriber, ma.subscriber_db
ORDER BY PublisherDB, Publication, Subscriber, SubscriberDB
"@
        
        $result = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $query -SqlCredential $SqlCredential `
            -LogMessage "Retrieving replication performance metrics" `
            -LogErrorMessage "Failed to retrieve replication performance metrics"
        
        return $result
    }
    catch {
        Write-Log "Error retrieving replication performance metrics: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Format-OutputResult {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [PSObject]$Results,
        
        [Parameter(Mandatory = $true)]
        [string]$OutputFormat,
        
        [Parameter(Mandatory = $false)]
        [string]$OutputPath,
        
        [Parameter(Mandatory = $false)]
        [string]$Title = "SQL Server Replication Monitoring Report"
    )
    
    try {
        switch ($OutputFormat) {
            "Console" {
                Write-Host "`n$Title" -ForegroundColor Cyan
                Write-Host "===================================================" -ForegroundColor Cyan
                
                foreach ($key in $Results.Keys) {
                    if ($Results[$key] -and $Results[$key].Count -gt 0) {
                        Write-Host "`n$key" -ForegroundColor Yellow
                        Write-Host "---------------------------------------------------" -ForegroundColor Yellow
                        $Results[$key] | Format-Table -AutoSize
                    }
                    elseif ($Results[$key] -and $Results[$key].GetType().Name -eq "PSCustomObject") {
                        Write-Host "`n$key" -ForegroundColor Yellow
                        Write-Host "---------------------------------------------------" -ForegroundColor Yellow
                        $Results[$key] | Format-List
                    }
                    else {
                        Write-Host "`n$key" -ForegroundColor Yellow
                        Write-Host "---------------------------------------------------" -ForegroundColor Yellow
                        Write-Host "No data available" -ForegroundColor Gray
                    }
                }
            }
            
            "GridView" {
                foreach ($key in $Results.Keys) {
                    if ($Results[$key] -and $Results[$key].Count -gt 0) {
                        $Results[$key] | Out-GridView -Title "$Title - $key"
                    }
                }
            }
            
            "Html" {
                if (-not $OutputPath) {
                    throw "OutputPath is required when using Html output format"
                }
                
                $htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <title>$Title</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #0066cc; }
        h2 { color: #336699; margin-top: 20px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th { background-color: #f2f2f2; text-align: left; padding: 8px; border: 1px solid #ddd; }
        td { padding: 8px; border: 1px solid #ddd; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .alert { color: red; font-weight: bold; }
        .ok { color: green; }
        .warning { color: orange; }
    </style>
</head>
<body>
    <h1>$Title</h1>
    <p>Generated on: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")</p>
    <p>Server: $ServerInstance</p>
"@
                
                foreach ($key in $Results.Keys) {
                    if ($Results[$key] -and $Results[$key].Count -gt 0) {
                        $htmlReport += "<h2>$key</h2>`n<table>`n<tr>"
                        
                        # Add headers
                        foreach ($property in $Results[$key][0].PSObject.Properties) {
                            $htmlReport += "<th>$($property.Name)</th>"
                        }
                        $htmlReport += "</tr>`n"
                        
                        # Add data rows
                        foreach ($item in $Results[$key]) {
                            $htmlReport += "<tr>"
                            foreach ($property in $item.PSObject.Properties) {
                                $value = $property.Value
                                $class = ""
                                
                                # Apply styling based on status-like fields
                                if ($property.Name -like "*Status*" -or $property.Name -eq "RunStatus") {
                                    if ($value -eq "Failed" -or $value -eq "Alert" -or $value -eq "Error") {
                                        $class = ' class="alert"'
                                    }
                                    elseif ($value -eq "OK" -or $value -eq "Succeeded") {
                                        $class = ' class="ok"'
                                    }
                                    elseif ($value -eq "Retrying" -or $value -eq "Warning") {
                                        $class = ' class="warning"'
                                    }
                                }
                                
                                $htmlReport += "<td$class>$value</td>"
                            }
                            $htmlReport += "</tr>`n"
                        }
                        
                        $htmlReport += "</table>`n"
                    }
                    elseif ($Results[$key] -and $Results[$key].GetType().Name -eq "PSCustomObject") {
                        $htmlReport += "<h2>$key</h2>`n<table>`n"
                        
                        foreach ($property in $Results[$key].PSObject.Properties) {
                            $htmlReport += "<tr><th>$($property.Name)</th><td>$($property.Value)</td></tr>`n"
                        }
                        
                        $htmlReport += "</table>`n"
                    }
                    else {
                        $htmlReport += "<h2>$key</h2>`n<p>No data available</p>`n"
                    }
                }
                
                $htmlReport += @"
</body>
</html>
"@
                
                $htmlReport | Out-File -FilePath $OutputPath -Encoding UTF8
                Write-Log "HTML report saved to $OutputPath" -Level Info
            }
            
            "Json" {
                if (-not $OutputPath) {
                    throw "OutputPath is required when using Json output format"
                }
                
                $Results | ConvertTo-Json -Depth 4 | Out-File -FilePath $OutputPath -Encoding UTF8
                Write-Log "JSON data saved to $OutputPath" -Level Info
            }
            
            "Csv" {
                if (-not $OutputPath) {
                    throw "OutputPath is required when using CSV output format"
                }
                
                # Create a directory if it doesn't exist
                $directory = Split-Path -Path $OutputPath -Parent
                if (-not (Test-Path -Path $directory -PathType Container)) {
                    New-Item -Path $directory -ItemType Directory -Force | Out-Null
                }
                
                # Export each result to a separate CSV file
                foreach ($key in $Results.Keys) {
                    if ($Results[$key] -and $Results[$key].Count -gt 0) {
                        $csvPath = Join-Path -Path $directory -ChildPath "$key.csv"
                        $Results[$key] | Export-Csv -Path $csvPath -NoTypeInformation
                        Write-Log "CSV data for $key saved to $csvPath" -Level Info
                    }
                }
            }
        }
    }
    catch {
        Write-Log "Error formatting output results: $_" -Level Error -WriteToEventLog:$LogToEventLog
    }
}

# Main script execution
try {
    # Validate SQL connection to server instance
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }
    
    $results = @{}
    
    # Check if instance is a distributor
    $distributorStatus = Get-DistributorStatus -ServerInstance $ServerInstance -SqlCredential $SqlCredential
    $results["DistributorStatus"] = $distributorStatus
    
    # Based on monitoring type, collect additional information
    switch ($MonitorType) {
        "AgentStatus" {
            # Retrieve publication information if this is a publisher
            if ($distributorStatus.IsPublisher -eq 1) {
                $publicationStatus = Get-PublicationStatus -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
                $results["TransactionalPublications"] = $publicationStatus.TransactionalPublications
                $results["MergePublications"] = $publicationStatus.MergePublications
            }
            
            # Get subscription status
            $subscriptionStatus = Get-SubscriptionStatus -ServerInstance $ServerInstance -PublicationDB $PublicationDB -SubscriptionDB $SubscriptionDB -PublicationName $PublicationName -SqlCredential $SqlCredential
            $results["TransactionalSubscriptions"] = $subscriptionStatus.TransactionalSubscriptions
            $results["MergeSubscriptions"] = $subscriptionStatus.MergeSubscriptions
        }
        
        "LatencyCheck" {
            # Focus on performance metrics
            $performanceMetrics = Get-ReplicationPerformanceMetrics -ServerInstance $ServerInstance -SqlCredential $SqlCredential
            $results["PerformanceMetrics"] = $performanceMetrics
            
            # Get subscription status with focus on latency
            $subscriptionStatus = Get-SubscriptionStatus -ServerInstance $ServerInstance -PublicationDB $PublicationDB -SubscriptionDB $SubscriptionDB -PublicationName $PublicationName -SqlCredential $SqlCredential
            
            # Filter to show only subscriptions with latency issues
            $latencyIssues = $subscriptionStatus.TransactionalSubscriptions | Where-Object { $_.LatencyStatus -eq "Alert" }
            $results["LatencyAlerts"] = $latencyIssues
            
            $mergeLatencyIssues = $subscriptionStatus.MergeSubscriptions | Where-Object { $_.LatencyStatus -eq "Alert" }
            $results["MergeLatencyAlerts"] = $mergeLatencyIssues
        }
        
        "ErrorOnly" {
            # Focus on errors
            $replicationErrors = Get-ReplicationErrors -ServerInstance $ServerInstance -Hours 24 -SqlCredential $SqlCredential
            $results["ReplicationErrors"] = $replicationErrors
        }
        
        "Comprehensive" {
            # Get everything
            # Publications
            if ($distributorStatus.IsPublisher -eq 1) {
                $publicationStatus = Get-PublicationStatus -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
                $results["TransactionalPublications"] = $publicationStatus.TransactionalPublications
                $results["MergePublications"] = $publicationStatus.MergePublications
            }
            
            # Subscriptions
            $subscriptionStatus = Get-SubscriptionStatus -ServerInstance $ServerInstance -PublicationDB $PublicationDB -SubscriptionDB $SubscriptionDB -PublicationName $PublicationName -SqlCredential $SqlCredential
            $results["TransactionalSubscriptions"] = $subscriptionStatus.TransactionalSubscriptions
            $results["MergeSubscriptions"] = $subscriptionStatus.MergeSubscriptions
            
            # Performance metrics
            $performanceMetrics = Get-ReplicationPerformanceMetrics -ServerInstance $ServerInstance -SqlCredential $SqlCredential
            $results["PerformanceMetrics"] = $performanceMetrics
            
            # Errors
            $replicationErrors = Get-ReplicationErrors -ServerInstance $ServerInstance -Hours 24 -SqlCredential $SqlCredential
            $results["ReplicationErrors"] = $replicationErrors
        }
    }
    
    # Format and output the results
    Format-OutputResult -Results $results -OutputFormat $OutputFormat -OutputPath $OutputPath -Title "SQL Server Replication Monitoring Report - $ServerInstance"
    
    # Log completion
    Write-Log "Replication monitoring completed successfully" -Level Success -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    
    # Return a PS object with the results if this is being used in a pipeline
    return [PSCustomObject]$results
}
catch {
    Write-Log "Error in Monitor-Replication: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
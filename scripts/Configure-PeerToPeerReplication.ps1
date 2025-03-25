<#
.SYNOPSIS
    Configures peer-to-peer replication between SQL Server instances.

.DESCRIPTION
    Sets up peer-to-peer transactional replication between multiple SQL Server
    instances. This enables bi-directional data synchronization between all nodes
    in the topology. Peer-to-peer replication is useful for high-availability and
    scale-out read workloads across geographical locations.

.PARAMETER NodeList
    Array of SQL Server instance names that will participate in the peer-to-peer topology.

.PARAMETER DatabaseName
    The name of the database to replicate. All nodes must have an identical schema.

.PARAMETER PublicationName
    The name to use for the publication on each node.

.PARAMETER Articles
    Array of tables to include in the replication. If not specified, all tables will be included.

.PARAMETER DistributorMap
    Hashtable mapping each node to its distributor. Format: @{'Node1'='Distributor1'; 'Node2'='Distributor2'}
    If not specified, each node will be its own distributor.

.PARAMETER SnapshotFolder
    The folder for storing snapshots. Default is the default snapshot folder on the first node.

.PARAMETER ConnectionTimeout
    The SQL connection timeout in seconds.

.PARAMETER NoInitialSnapshot
    Switch to skip generating an initial snapshot. Use when databases are already synchronized.

.PARAMETER Force
    Switch to force removal of existing configurations before setting up the new topology.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials for connecting to SQL Server instances.

.EXAMPLE
    .\Configure-PeerToPeerReplication.ps1 -NodeList @('SQLSERVER1', 'SQLSERVER2', 'SQLSERVER3') -DatabaseName 'SalesDB' -PublicationName 'P2P_Sales'
    
    Configures peer-to-peer replication for SalesDB between three SQL Server instances.

.EXAMPLE
    .\Configure-PeerToPeerReplication.ps1 -NodeList @('SQLSERVER1', 'SQLSERVER2') -DatabaseName 'Products' -PublicationName 'P2P_Products' -Articles @('Products', 'Categories', 'Suppliers') -NoInitialSnapshot -Force

    Configures peer-to-peer replication for specific tables in the Products database between two servers, without initial snapshot.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
    
    Requirements:
    - All participating servers must be running SQL Server Enterprise Edition
    - Server-level and database-level requirements for peer-to-peer replication must be met
    - All nodes must have identical schema and initial data should be synchronized
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]]$NodeList,
    
    [Parameter(Mandatory = $true, Position = 1)]
    [string]$DatabaseName,
    
    [Parameter(Mandatory = $true, Position = 2)]
    [string]$PublicationName,
    
    [Parameter(Mandatory = $false)]
    [string[]]$Articles,
    
    [Parameter(Mandatory = $false)]
    [hashtable]$DistributorMap,
    
    [Parameter(Mandatory = $false)]
    [string]$SnapshotFolder,
    
    [Parameter(Mandatory = $false)]
    [int]$ConnectionTimeout = 30,
    
    [Parameter(Mandatory = $false)]
    [switch]$NoInitialSnapshot,
    
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

function Validate-P2PRequirements {
    [CmdletBinding()]
    param (
        [string[]]$NodeList,
        [string]$DatabaseName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    $results = @{
        IsValid = $true
        Errors = @()
    }
    
    foreach ($node in $NodeList) {
        Write-Log "Validating peer-to-peer requirements on node: $node" -Level Info
        
        # Check if server is reachable
        if (-not (Test-SqlConnection -ServerInstance $node -SqlCredential $SqlCredential -Timeout $ConnectionTimeout)) {
            $results.Errors += "Cannot connect to SQL Server instance: $node"
            $results.IsValid = $false
            continue
        }
        
        # Check if server is Enterprise Edition (required for peer-to-peer)
        $editionQuery = "SELECT SERVERPROPERTY('Edition') AS Edition"
        $edition = Invoke-SqlCmdWithLogging -ServerInstance $node -Query $editionQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking SQL Server edition on node: $node" `
            -LogErrorMessage "Failed to check SQL Server edition"
        
        if ($edition.Edition -notlike "*Enterprise*") {
            $results.Errors += "SQL Server instance $node is not Enterprise Edition. Peer-to-peer replication requires Enterprise Edition."
            $results.IsValid = $false
        }
        
        # Check if database exists
        $dbQuery = "SELECT COUNT(*) AS DbExists FROM sys.databases WHERE name = '$DatabaseName'"
        $dbExists = Invoke-SqlCmdWithLogging -ServerInstance $node -Query $dbQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking if database '$DatabaseName' exists on node: $node" `
            -LogErrorMessage "Failed to check database existence"
        
        if ($dbExists.DbExists -eq 0) {
            $results.Errors += "Database '$DatabaseName' does not exist on node: $node"
            $results.IsValid = $false
            continue
        }
        
        # Check if database has RECOVERY set to FULL
        $recoveryQuery = "SELECT recovery_model_desc FROM sys.databases WHERE name = '$DatabaseName'"
        $recovery = Invoke-SqlCmdWithLogging -ServerInstance $node -Query $recoveryQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking database recovery model on node: $node" `
            -LogErrorMessage "Failed to check database recovery model"
        
        if ($recovery.recovery_model_desc -ne "FULL") {
            $results.Errors += "Database '$DatabaseName' on node $node is not in FULL recovery model. Peer-to-peer replication requires FULL recovery model."
            $results.IsValid = $false
        }
        
        # Check if tables have primary keys
        if ($Articles) {
            $articleList = "'" + ($Articles -join "','") + "'"
            $pkQuery = @"
SELECT t.name AS TableName
FROM sys.tables t
WHERE t.name IN ($articleList)
AND NOT EXISTS (
    SELECT 1 
    FROM sys.indexes i 
    WHERE i.object_id = t.object_id 
    AND i.is_primary_key = 1
)
"@
            $tablesWithoutPK = Invoke-SqlCmdWithLogging -ServerInstance $node -Database $DatabaseName -Query $pkQuery -SqlCredential $SqlCredential `
                -LogMessage "Checking primary keys on tables on node: $node" `
                -LogErrorMessage "Failed to check primary keys"
            
            if ($tablesWithoutPK) {
                foreach ($table in $tablesWithoutPK) {
                    $results.Errors += "Table '$($table.TableName)' on node $node does not have a primary key. All replicated tables must have primary keys."
                    $results.IsValid = $false
                }
            }
        }
    }
    
    return $results
}

function Configure-Distributor {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$Node,
        [string]$Distributor,
        [string]$DistributionDB = "distribution",
        [string]$SnapshotFolder,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $isRemoteDistributor = $Node -ne $Distributor
        
        if ($isRemoteDistributor) {
            Write-Log "Configuring remote distributor for node $Node using distributor $Distributor" -Level Info
            
            # Configure server as distributor
            $configQuery = @"
EXEC sp_adddistributor @distributor = N'$Distributor', @password = N''
"@
            
            if ($PSCmdlet.ShouldProcess($Node, "Configure as distributor")) {
                Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $configQuery -SqlCredential $SqlCredential `
                    -LogMessage "Configuring node $Node to use $Distributor as distributor" `
                    -LogErrorMessage "Failed to configure distributor"
            }
        }
        else {
            Write-Log "Configuring local distribution on node $Node" -Level Info
            
            # Check if distribution database exists
            $distributionDbExists = Test-DistributionDatabase -ServerInstance $Node -DistributionDB $DistributionDB -SqlCredential $SqlCredential
            
            if (-not $distributionDbExists) {
                # Get default paths if not already a distributor
                $dataPath = Get-SqlDefaultDataPath -ServerInstance $Node -SqlCredential $SqlCredential
                $logPath = Get-SqlDefaultLogPath -ServerInstance $Node -SqlCredential $SqlCredential
                
                # Configure server as a distributor with local distribution database
                $configQuery = @"
DECLARE @data_folder nvarchar(500), @data_file nvarchar(500), @data_file_size int
DECLARE @log_folder nvarchar(500), @log_file nvarchar(500), @log_file_size int

SET @data_folder = N'$dataPath'
SET @data_file = N'$dataPath$DistributionDB.mdf'
SET @data_file_size = 50

SET @log_folder = N'$logPath'
SET @log_file = N'$logPath$DistributionDB.ldf'
SET @log_file_size = 50

EXEC sp_adddistributiondb 
    @database = N'$DistributionDB', 
    @data_folder = @data_folder, 
    @data_file = @data_file, 
    @data_file_size = @data_file_size, 
    @log_folder = @log_folder, 
    @log_file = @log_file, 
    @log_file_size = @log_file_size, 
    @min_distretention = 0, 
    @max_distretention = 72, 
    @history_retention = 48, 
    @security_mode = 1

EXEC sp_adddistributor @distributor = N'$Node', @password = N''
"@
                
                if ($PSCmdlet.ShouldProcess($Node, "Configure local distribution")) {
                    Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $configQuery -SqlCredential $SqlCredential `
                        -LogMessage "Setting up distribution database '$DistributionDB' on node $Node" `
                        -LogErrorMessage "Failed to set up distribution database"
                }
            }
            else {
                Write-Log "Distribution database '$DistributionDB' already exists on node $Node" -Level Info
            }
        }
        
        return $true
    }
    catch {
        Write-Log "Error configuring distributor: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function New-P2PPublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$Node,
        [string]$DatabaseName,
        [string]$PublicationName,
        [string[]]$Articles,
        [string]$SnapshotFolder,
        [bool]$NoInitialSnapshot,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # First check if publication already exists
        $pubCheckQuery = "USE [$DatabaseName]; EXEC sp_helppublication @publication = N'$PublicationName'"
        $pubExists = $null
        
        try {
            $pubExists = Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $pubCheckQuery -SqlCredential $SqlCredential `
                -LogMessage "Checking if publication '$PublicationName' already exists on node $Node" `
                -LogErrorMessage "Failed to check publication existence" -ContinueOnError
        }
        catch {
            # Expected exception if publication does not exist
            $pubExists = $null
        }
        
        if ($pubExists -and $Force) {
            Write-Log "Publication '$PublicationName' already exists on node $Node. Removing due to -Force parameter." -Level Warning
            
            $dropPubQuery = "USE [$DatabaseName]; EXEC sp_droppublication @publication = N'$PublicationName'"
            
            if ($PSCmdlet.ShouldProcess($Node, "Drop existing publication")) {
                Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $dropPubQuery -SqlCredential $SqlCredential `
                    -LogMessage "Dropping existing publication '$PublicationName' on node $Node" `
                    -LogErrorMessage "Failed to drop existing publication"
            }
        }
        elseif ($pubExists) {
            Write-Log "Publication '$PublicationName' already exists on node $Node. Use -Force to recreate." -Level Warning
            return $false
        }
        
        # Enable the database for peer-to-peer replication
        $enableDbQuery = "USE [$DatabaseName]; EXEC sp_replicationdboption @dbname = N'$DatabaseName', @optname = N'publish', @value = N'true'"
        
        if ($PSCmdlet.ShouldProcess($Node, "Enable database for publishing")) {
            Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $enableDbQuery -SqlCredential $SqlCredential `
                -LogMessage "Enabling publishing for database '$DatabaseName' on node $Node" `
                -LogErrorMessage "Failed to enable publishing for database"
        }
        
        # Create the publication with peer-to-peer enabled
        $createPubQuery = @"
USE [$DatabaseName]

-- Add a new transactional publication
EXEC sp_addpublication 
    @publication = N'$PublicationName', 
    @description = N'Peer-to-Peer publication of database $DatabaseName', 
    @sync_method = N'concurrent', 
    @retention = 0, 
    @allow_push = N'true', 
    @allow_pull = N'true', 
    @allow_anonymous = N'false', 
    @enabled_for_internet = N'false', 
    @snapshot_in_defaultfolder = N'true', 
    @compress_snapshot = N'false', 
    @ftp_port = 21, 
    @allow_subscription_copy = N'false', 
    @add_to_active_directory = N'false', 
    @repl_freq = N'continuous', 
    @status = N'active', 
    @independent_agent = N'true', 
    @immediate_sync = N'true', 
    @allow_sync_tran = N'false', 
    @allow_queued_tran = N'false', 
    @allow_dts = N'false', 
    @replicate_ddl = 1, 
    @enabled_for_p2p = N'true', 
    @enabled_for_het_sub = N'false'

-- Add the snapshot agent for the publication
EXEC sp_addpublication_snapshot 
    @publication = N'$PublicationName', 
    @frequency_type = 1, 
    @frequency_interval = 0, 
    @frequency_relative_interval = 0, 
    @frequency_recurrence_factor = 0, 
    @frequency_subday = 0, 
    @frequency_subday_interval = 0, 
    @active_start_time_of_day = 0, 
    @active_end_time_of_day = 235959, 
    @active_start_date = 0, 
    @active_end_date = 0, 
    @job_login = null, 
    @job_password = null, 
    @publisher_security_mode = 1
"@
        
        if ($PSCmdlet.ShouldProcess($Node, "Create peer-to-peer publication")) {
            Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $createPubQuery -SqlCredential $SqlCredential `
                -LogMessage "Creating peer-to-peer publication '$PublicationName' on node $Node" `
                -LogErrorMessage "Failed to create peer-to-peer publication"
        }
        
        # Add articles to the publication
        if ($Articles) {
            Write-Log "Adding specified articles to publication" -Level Info
            
            foreach ($article in $Articles) {
                # Check if the article exists
                $articleCheckQuery = "USE [$DatabaseName]; SELECT OBJECT_ID('$article') AS object_id"
                $articleObj = Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $articleCheckQuery -SqlCredential $SqlCredential `
                    -LogMessage "Checking if article '$article' exists" `
                    -LogErrorMessage "Failed to check article existence"
                
                if ($articleObj.object_id) {
                    # Add the article to the publication
                    $addArticleQuery = @"
USE [$DatabaseName]
EXEC sp_addarticle 
    @publication = N'$PublicationName', 
    @article = N'$article', 
    @source_owner = N'dbo', 
    @source_object = N'$article', 
    @type = N'logbased', 
    @description = N'', 
    @creation_script = N'', 
    @pre_creation_cmd = N'drop', 
    @schema_option = 0x000000000803509F, 
    @identityrangemanagementoption = N'manual', 
    @destination_table = N'$article', 
    @destination_owner = N'dbo', 
    @vertical_partition = N'false'
"@
                    
                    if ($PSCmdlet.ShouldProcess($Node, "Add article $article to publication")) {
                        Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $addArticleQuery -SqlCredential $SqlCredential `
                            -LogMessage "Adding article '$article' to publication '$PublicationName' on node $Node" `
                            -LogErrorMessage "Failed to add article to publication"
                    }
                }
                else {
                    Write-Log "Article '$article' does not exist in database '$DatabaseName' on node $Node. Skipping." -Level Warning
                }
            }
        }
        else {
            # Add all tables as articles
            Write-Log "Adding all tables as articles to publication" -Level Info
            
            $tablesQuery = @"
USE [$DatabaseName]
SELECT name 
FROM sys.tables 
WHERE is_ms_shipped = 0 
AND NOT EXISTS (
    SELECT 1 
    FROM sys.indexes i 
    WHERE i.object_id = tables.object_id 
    AND i.is_primary_key = 1
)
"@
            
            $tables = Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $tablesQuery -SqlCredential $SqlCredential `
                -LogMessage "Getting list of tables to add as articles" `
                -LogErrorMessage "Failed to get list of tables"
            
            foreach ($table in $tables) {
                $tableName = $table.name
                
                # Add the article to the publication
                $addArticleQuery = @"
USE [$DatabaseName]
EXEC sp_addarticle 
    @publication = N'$PublicationName', 
    @article = N'$tableName', 
    @source_owner = N'dbo', 
    @source_object = N'$tableName', 
    @type = N'logbased', 
    @description = N'', 
    @creation_script = N'', 
    @pre_creation_cmd = N'drop', 
    @schema_option = 0x000000000803509F, 
    @identityrangemanagementoption = N'manual', 
    @destination_table = N'$tableName', 
    @destination_owner = N'dbo', 
    @vertical_partition = N'false'
"@
                
                if ($PSCmdlet.ShouldProcess($Node, "Add article $tableName to publication")) {
                    Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $addArticleQuery -SqlCredential $SqlCredential `
                        -LogMessage "Adding article '$tableName' to publication '$PublicationName' on node $Node" `
                        -LogErrorMessage "Failed to add article to publication"
                }
            }
        }
        
        # Generate initial snapshot if needed
        if (-not $NoInitialSnapshot) {
            Write-Log "Generating initial snapshot for publication '$PublicationName' on node $Node" -Level Info
            
            $snapshotQuery = "USE [$DatabaseName]; EXEC sp_startpublication_snapshot @publication = N'$PublicationName'"
            
            if ($PSCmdlet.ShouldProcess($Node, "Generate initial snapshot")) {
                Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $snapshotQuery -SqlCredential $SqlCredential `
                    -LogMessage "Starting snapshot generation for publication '$PublicationName' on node $Node" `
                    -LogErrorMessage "Failed to start snapshot generation"
            }
        }
        
        return $true
    }
    catch {
        Write-Log "Error creating peer-to-peer publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Add-P2PSubscription {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$PublisherNode,
        [string]$SubscriberNode,
        [string]$DatabaseName,
        [string]$PublicationName,
        [string]$DistributorNode,
        [bool]$NoInitialSnapshot,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Check if subscription already exists
        $subCheckQuery = "USE [$DatabaseName]; EXEC sp_helpsubscription @publication = N'$PublicationName', @subscriber = N'$SubscriberNode', @destination_db = N'$DatabaseName'"
        $subExists = $null
        
        try {
            $subExists = Invoke-SqlCmdWithLogging -ServerInstance $PublisherNode -Query $subCheckQuery -SqlCredential $SqlCredential `
                -LogMessage "Checking if subscription already exists" `
                -LogErrorMessage "Failed to check subscription existence" -ContinueOnError
        }
        catch {
            # Expected exception if subscription does not exist
            $subExists = $null
        }
        
        if ($subExists -and $Force) {
            Write-Log "Subscription from node $PublisherNode to $SubscriberNode already exists. Removing due to -Force parameter." -Level Warning
            
            $dropSubQuery = "USE [$DatabaseName]; EXEC sp_dropsubscription @publication = N'$PublicationName', @subscriber = N'$SubscriberNode', @destination_db = N'$DatabaseName', @article = N'all'"
            
            if ($PSCmdlet.ShouldProcess("$PublisherNode to $SubscriberNode", "Drop existing subscription")) {
                Invoke-SqlCmdWithLogging -ServerInstance $PublisherNode -Query $dropSubQuery -SqlCredential $SqlCredential `
                    -LogMessage "Dropping existing subscription from $PublisherNode to $SubscriberNode" `
                    -LogErrorMessage "Failed to drop existing subscription"
            }
        }
        elseif ($subExists) {
            Write-Log "Subscription from node $PublisherNode to $SubscriberNode already exists. Use -Force to recreate." -Level Warning
            return $false
        }
        
        # Add the subscription
        $syncType = $NoInitialSnapshot ? "none" : "automatic"
        
        $addSubQuery = @"
USE [$DatabaseName]
EXEC sp_addsubscription 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberNode', 
    @destination_db = N'$DatabaseName', 
    @subscription_type = N'push', 
    @sync_type = N'$syncType', 
    @article = N'all', 
    @update_mode = N'failover', 
    @subscriber_type = 0
"@
        
        if ($PSCmdlet.ShouldProcess("$PublisherNode to $SubscriberNode", "Create peer-to-peer subscription")) {
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherNode -Query $addSubQuery -SqlCredential $SqlCredential `
                -LogMessage "Adding subscription from $PublisherNode to $SubscriberNode" `
                -LogErrorMessage "Failed to add subscription"
        }
        
        # Add the distribution agent
        $addAgentQuery = @"
USE [$DatabaseName]
EXEC sp_addpushsubscription_agent 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberNode', 
    @subscriber_db = N'$DatabaseName', 
    @job_login = null, 
    @job_password = null, 
    @subscriber_security_mode = 1, 
    @frequency_type = 64, 
    @frequency_interval = 0, 
    @frequency_relative_interval = 0, 
    @frequency_recurrence_factor = 0, 
    @frequency_subday = 0, 
    @frequency_subday_interval = 0, 
    @active_start_time_of_day = 0, 
    @active_end_time_of_day = 235959, 
    @active_start_date = 0, 
    @active_end_date = 0, 
    @dts_package_location = N'Distributor'
"@
        
        if ($PSCmdlet.ShouldProcess("$PublisherNode to $SubscriberNode", "Create distribution agent")) {
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherNode -Query $addAgentQuery -SqlCredential $SqlCredential `
                -LogMessage "Adding distribution agent for subscription from $PublisherNode to $SubscriberNode" `
                -LogErrorMessage "Failed to add distribution agent"
        }
        
        return $true
    }
    catch {
        Write-Log "Error adding peer-to-peer subscription: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Start-P2PReplication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$Node,
        [string]$DatabaseName,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Start all the agents
        $startAgentsQuery = @"
USE msdb
EXEC sp_start_job @job_name = N'REPL-LogReader-$DatabaseName'
EXEC sp_start_job @job_name = N'REPL-Snapshot-$DatabaseName-$PublicationName'
"@
        
        if ($PSCmdlet.ShouldProcess($Node, "Start replication agents")) {
            Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $startAgentsQuery -SqlCredential $SqlCredential `
                -LogMessage "Starting replication agents on node $Node" `
                -LogErrorMessage "Failed to start replication agents"
        }
        
        # Get all push agents and start them
        $pushAgentsQuery = @"
USE msdb
SELECT name FROM sysjobs WHERE name LIKE 'REPL-Distribution-%$PublicationName%'
"@
        
        $pushAgents = Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $pushAgentsQuery -SqlCredential $SqlCredential `
            -LogMessage "Getting push agents on node $Node" `
            -LogErrorMessage "Failed to get push agents"
        
        foreach ($agent in $pushAgents) {
            $startPushQuery = "USE msdb; EXEC sp_start_job @job_name = N'$($agent.name)'"
            
            if ($PSCmdlet.ShouldProcess($Node, "Start push agent $($agent.name)")) {
                Invoke-SqlCmdWithLogging -ServerInstance $Node -Query $startPushQuery -SqlCredential $SqlCredential `
                    -LogMessage "Starting push agent $($agent.name) on node $Node" `
                    -LogErrorMessage "Failed to start push agent"
            }
        }
        
        return $true
    }
    catch {
        Write-Log "Error starting replication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

# Main script execution
try {
    # Validate that we have at least 2 nodes for peer-to-peer
    if ($NodeList.Count -lt 2) {
        throw "Peer-to-peer replication requires at least 2 nodes. Only $($NodeList.Count) provided."
    }
    
    # Validate that all nodes are unique
    $uniqueNodes = $NodeList | Select-Object -Unique
    if ($uniqueNodes.Count -ne $NodeList.Count) {
        throw "Duplicate nodes detected in the node list. Each node must be unique."
    }
    
    # Create distributor map if not provided
    if (-not $DistributorMap) {
        $DistributorMap = @{}
        foreach ($node in $NodeList) {
            $DistributorMap[$node] = $node # Each node is its own distributor
        }
    }
    
    # Validate that all nodes are listed in the distributor map
    foreach ($node in $NodeList) {
        if (-not $DistributorMap.ContainsKey($node)) {
            throw "Distributor not specified for node: $node. Update the DistributorMap parameter."
        }
    }
    
    # Validate peer-to-peer requirements
    $validation = Validate-P2PRequirements -NodeList $NodeList -DatabaseName $DatabaseName -SqlCredential $SqlCredential
    
    if (-not $validation.IsValid) {
        Write-Log "Validation of peer-to-peer requirements failed:" -Level Error
        foreach ($error in $validation.Errors) {
            Write-Log "  - $error" -Level Error
        }
        throw "Peer-to-peer requirements validation failed. See log for details."
    }
    
    # Set up distributors for each node
    foreach ($node in $NodeList) {
        $distributor = $DistributorMap[$node]
        
        if (-not (Configure-Distributor -Node $node -Distributor $distributor -SnapshotFolder $SnapshotFolder -SqlCredential $SqlCredential)) {
            throw "Failed to configure distributor for node: $node"
        }
    }
    
    # Create publications on each node
    foreach ($node in $NodeList) {
        if (-not (New-P2PPublication -Node $node -DatabaseName $DatabaseName -PublicationName $PublicationName -Articles $Articles -SnapshotFolder $SnapshotFolder -NoInitialSnapshot $NoInitialSnapshot -SqlCredential $SqlCredential)) {
            throw "Failed to create peer-to-peer publication on node: $node"
        }
    }
    
    # Create subscriptions between all nodes
    for ($i = 0; $i -lt $NodeList.Count; $i++) {
        $publisherNode = $NodeList[$i]
        
        for ($j = 0; $j -lt $NodeList.Count; $j++) {
            if ($i -ne $j) {
                $subscriberNode = $NodeList[$j]
                $distributorNode = $DistributorMap[$publisherNode]
                
                if (-not (Add-P2PSubscription -PublisherNode $publisherNode -SubscriberNode $subscriberNode -DatabaseName $DatabaseName -PublicationName $PublicationName -DistributorNode $distributorNode -NoInitialSnapshot $NoInitialSnapshot -SqlCredential $SqlCredential)) {
                    throw "Failed to create subscription from $publisherNode to $subscriberNode"
                }
            }
        }
    }
    
    # Start replication on all nodes
    foreach ($node in $NodeList) {
        if (-not (Start-P2PReplication -Node $node -DatabaseName $DatabaseName -PublicationName $PublicationName -SqlCredential $SqlCredential)) {
            Write-Log "Warning: Failed to start replication on node: $node. Manual start may be required." -Level Warning
        }
    }
    
    Write-Log "Peer-to-peer replication configuration completed successfully." -Level Success
    Write-Log "Topology: $(($NodeList -join ', '))" -Level Info
    Write-Log "Database: $DatabaseName" -Level Info
    Write-Log "Publication: $PublicationName" -Level Info
}
catch {
    Write-Log "Error in Configure-PeerToPeerReplication: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
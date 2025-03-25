<#
.SYNOPSIS
    Configures a SQL Server replication publication of the specified type.

.DESCRIPTION
    Creates a publication in the specified database with support for all replication
    types including snapshot, transactional, merge, peer-to-peer, and immediate/queued
    updating subscribers. Supports optional article filtering and other advanced options.

.PARAMETER ServerInstance
    The SQL Server instance hosting the publisher database.

.PARAMETER PublicationDB
    The database containing the data to be published.

.PARAMETER PublicationName
    The name for the publication.

.PARAMETER ReplicationType
    The type of replication to configure:
    - Snapshot: One-time or scheduled data snapshot
    - Transactional: Continuous data changes with atomicity
    - Merge: Bi-directional data changes with conflict resolution
    - PeerToPeer: Multi-master transactional replication
    - TransactionalWithUpdatableSubscribers: Transactional with subscriber write capability

.PARAMETER Articles
    Array of object names (tables, stored procedures, etc.) to include in the publication.

.PARAMETER FilterClauses
    Optional array of WHERE clauses to filter published data (without the WHERE keyword).
    Format should be: "TableName:FilterExpression" (e.g. "Orders:CustomerID > 1000")

.PARAMETER AllowAnonymousSubscribers
    Allow anonymous subscribers to subscribe to the publication.

.PARAMETER AllowPullSubscriptions
    Allow pull subscriptions for this publication.

.PARAMETER ImmediateSync
    Whether subscribers should be immediately synchronized after subscription.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials if not using Windows Authentication.

.PARAMETER ConflictResolution
    For merge replication: PublisherWins | SubscriberWins | Custom
    
.PARAMETER SnapshotGenerationScript
    Optional path to custom snapshot generation script.

.PARAMETER Force
    Recreate the publication if it already exists.

.PARAMETER LogToEventLog
    Switch to enable logging to the Windows Event Log.

.PARAMETER LogToSqlTable
    Switch to enable logging to a SQL Server table.

.EXAMPLE
    .\Configure-Publication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "SalesPublication" -ReplicationType "Transactional" -Articles "Customers","Orders","OrderDetails"
    
    Creates a transactional publication named SalesPublication in the SalesDB database with three articles.

.EXAMPLE
    .\Configure-Publication.ps1 -ServerInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "FilteredSalesPublication" -ReplicationType "Merge" -Articles "Orders","OrderDetails" -FilterClauses "Orders:OrderDate > '2023-01-01'"
    
    Creates a merge publication with a filtered Orders table.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServerInstance,
    
    [Parameter(Mandatory = $true, Position = 1)]
    [string]$PublicationDB,
    
    [Parameter(Mandatory = $true, Position = 2)]
    [string]$PublicationName,
    
    [Parameter(Mandatory = $true)]
    [ValidateSet("Snapshot", "Transactional", "Merge", "PeerToPeer", "TransactionalWithUpdatableSubscribers")]
    [string]$ReplicationType,
    
    [Parameter()]
    [string[]]$Articles,
    
    [Parameter()]
    [string[]]$FilterClauses,
    
    [Parameter()]
    [switch]$AllowAnonymousSubscribers,
    
    [Parameter()]
    [switch]$AllowPullSubscriptions = $true,
    
    [Parameter()]
    [switch]$ImmediateSync = $true,
    
    [Parameter()]
    [ValidateSet("PublisherWins", "SubscriberWins", "Custom")]
    [string]$ConflictResolution = "PublisherWins",
    
    [Parameter()]
    [string]$SnapshotGenerationScript,
    
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

function New-SnapshotPublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [bool]$AllowAnonymousSubscribers,
        [bool]$AllowPullSubscriptions,
        [bool]$ImmediateSync,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = @"
EXEC sp_addpublication 
    @publication = N'$PublicationName', 
    @description = N'Snapshot publication of database $PublicationDB created by PowerShell script',
    @status = N'active',
    @allow_push = N'true',
    @allow_pull = N'$(if ($AllowPullSubscriptions) {'true'} else {'false'})',
    @allow_anonymous = N'$(if ($AllowAnonymousSubscribers) {'true'} else {'false'})',
    @repl_freq = N'snapshot',
    @retention = 0,
    @immediate_sync = N'$(if ($ImmediateSync) {'true'} else {'false'})',
    @allow_sync_tran = N'false',
    @replicate_ddl = 1,
    @independent_agent = N'true',
    @enabled_for_internet = N'false',
    @sync_method = N'concurrent_c'
"@
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Create snapshot publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Creating snapshot publication '$PublicationName' in database '$PublicationDB'" `
                -LogErrorMessage "Failed to create snapshot publication"
            
            Write-Log "Successfully created snapshot publication '$PublicationName' in database '$PublicationDB'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating snapshot publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function New-TransactionalPublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [bool]$AllowAnonymousSubscribers,
        [bool]$AllowPullSubscriptions,
        [bool]$ImmediateSync,
        [bool]$WithUpdatableSubscribers,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        $query = @"
EXEC sp_addpublication 
    @publication = N'$PublicationName', 
    @description = N'Transactional publication of database $PublicationDB created by PowerShell script',
    @status = N'active',
    @allow_push = N'true',
    @allow_pull = N'$(if ($AllowPullSubscriptions) {'true'} else {'false'})',
    @allow_anonymous = N'$(if ($AllowAnonymousSubscribers) {'true'} else {'false'})',
    @repl_freq = N'continuous',
    @retention = 0,
    @immediate_sync = N'$(if ($ImmediateSync) {'true'} else {'false'})',
    @replicate_ddl = 1,
    @independent_agent = N'true',
    @allow_sync_tran = N'false',
    @enabled_for_internet = N'false',
    @sync_method = N'concurrent_c'
"@
        
        # If updatable subscribers are enabled, add those options
        if ($WithUpdatableSubscribers) {
            $query += ",
    @allow_queued_tran = N'true',
    @allow_immediate_updating_subscription = N'true'"
        }
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Create transactional publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Creating transactional publication '$PublicationName' in database '$PublicationDB'" `
                -LogErrorMessage "Failed to create transactional publication"
            
            if ($WithUpdatableSubscribers) {
                Write-Log "Publication configured for updatable subscribers" -Level Info
            }
            
            Write-Log "Successfully created transactional publication '$PublicationName' in database '$PublicationDB'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating transactional publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function New-PeerToPeerPublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Peer-to-peer is essentially transactional with specific settings
        $query = @"
EXEC sp_addpublication 
    @publication = N'$PublicationName', 
    @description = N'Peer-to-peer publication of database $PublicationDB created by PowerShell script',
    @status = N'active',
    @allow_push = N'true',
    @allow_pull = N'false',
    @allow_anonymous = N'false',
    @repl_freq = N'continuous',
    @retention = 0,
    @immediate_sync = N'true',
    @replicate_ddl = 1,
    @independent_agent = N'true',
    @allow_sync_tran = N'false',
    @allow_queued_tran = N'false',
    @enabled_for_internet = N'false',
    @sync_method = N'concurrent'
"@
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Create peer-to-peer publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Creating peer-to-peer publication '$PublicationName' in database '$PublicationDB'" `
                -LogErrorMessage "Failed to create peer-to-peer publication"
            
            # Enable conflict detection for the peer-to-peer topolgy
            $conflictQuery = @"
EXEC sp_addpublication 
    @publication = N'$PublicationName',
    @conflict_detection = N'enabled',
    @property = N'p2p_conflict_detection'
"@
            
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $conflictQuery -SqlCredential $SqlCredential `
                -LogMessage "Enabling conflict detection for peer-to-peer publication" `
                -LogErrorMessage "Failed to enable conflict detection"
            
            Write-Log "Successfully created peer-to-peer publication '$PublicationName' in database '$PublicationDB'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating peer-to-peer publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function New-MergePublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [bool]$AllowAnonymousSubscribers,
        [bool]$AllowPullSubscriptions,
        [string]$ConflictResolution,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Map conflict resolution to merge publication options
        $conflictPolicy = switch ($ConflictResolution) {
            "PublisherWins" { "pub wins" }
            "SubscriberWins" { "sub wins" }
            "Custom" { "custom" }
            default { "pub wins" }
        }
        
        $query = @"
EXEC sp_addmergepublication 
    @publication = N'$PublicationName', 
    @description = N'Merge publication of database $PublicationDB created by PowerShell script',
    @retention = 14,
    @sync_mode = N'native',
    @allow_push = N'true',
    @allow_pull = N'$(if ($AllowPullSubscriptions) {'true'} else {'false'})',
    @allow_anonymous = N'$(if ($AllowAnonymousSubscribers) {'true'} else {'false'})',
    @enabled_for_internet = N'false',
    @conflict_resolution = N'$conflictPolicy',
    @centralized_conflicts = N'true',
    @replicate_ddl = 1,
    @allow_subscriber_initiated_snapshot = N'true',
    @allow_subscription_copy = N'false'
"@
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Create merge publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Creating merge publication '$PublicationName' in database '$PublicationDB'" `
                -LogErrorMessage "Failed to create merge publication"
            
            if ($ConflictResolution -eq "Custom") {
                Write-Log "Note: Custom conflict resolution was selected. You will need to set up your custom resolver separately." -Level Warning
            }
            
            Write-Log "Successfully created merge publication '$PublicationName' in database '$PublicationDB'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating merge publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Add-Articles {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$ReplicationType,
        [string[]]$Articles,
        [string[]]$FilterClauses,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        if ($null -eq $Articles -or $Articles.Count -eq 0) {
            Write-Log "No articles specified, skipping article creation." -Level Warning
            return $true
        }
        
        # Determine the appropriate article creation method for the replication type
        $addArticleProc = switch ($ReplicationType) {
            "Merge" { "sp_addmergearticle" }
            default { "sp_addarticle" } # For snapshot, transactional, and p2p
        }
        
        foreach ($article in $Articles) {
            # Check if there's a filter for this article
            $filterClause = $null
            foreach ($filter in $FilterClauses) {
                if ($filter.StartsWith("$article`:")) {
                    $filterClause = $filter.Substring($article.Length + 1)
                    break
                }
            }
            
            if ($ReplicationType -eq "Merge") {
                $query = @"
EXEC $addArticleProc
    @publication = N'$PublicationName',
    @article = N'$article',
    @source_object = N'$article',
    @source_owner = N'dbo',
    @force_invalidate_snapshot = 1
"@
                if ($filterClause) {
                    $query += ",
    @subset_filterclause = N'$filterClause'"
                }
            } 
            else {
                # For snapshot, transactional, peer-to-peer
                $query = @"
EXEC $addArticleProc
    @publication = N'$PublicationName',
    @article = N'$article',
    @source_object = N'$article',
    @source_owner = N'dbo',
    @force_invalidate_snapshot = 1,
    @schema_option = 0x000000000803509F, -- Include identity values, primary keys, etc.
    @identityrangemanagementoption = N'manual'
"@
                if ($filterClause) {
                    $query += ",
    @filter_clause = N'$filterClause'"
                }
            }
            
            if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Add article '$article' to publication '$PublicationName'")) {
                Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Adding article '$article' to publication '$PublicationName'" `
                    -LogErrorMessage "Failed to add article '$article'"
                
                if ($filterClause) {
                    Write-Log "Added article '$article' with filter: $filterClause" -Level Info
                } else {
                    Write-Log "Added article '$article'" -Level Info
                }
            }
        }
        
        Write-Log "Successfully added all articles to publication '$PublicationName'" -Level Success
        return $true
    }
    catch {
        Write-Log "Error adding articles: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Remove-ExistingPublication {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$ReplicationType,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Get information about the existing publication
        $pubInfo = Get-PublicationInfo -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
        
        if ($null -eq $pubInfo) {
            # Publication doesn't exist, nothing to remove
            return $true
        }
        
        # Drop the publication based on type
        $dropPublicationProc = switch ($ReplicationType) {
            "Merge" { "sp_dropmergepublication" }
            default { "sp_droppublication" } # For snapshot, transactional, and p2p
        }
        
        $query = "EXEC $dropPublicationProc @publication = N'$PublicationName'"
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Drop existing publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Dropping existing publication '$PublicationName'" `
                -LogErrorMessage "Failed to drop existing publication"
            
            Write-Log "Successfully dropped existing publication '$PublicationName'" -Level Info
            return $true
        }
    }
    catch {
        Write-Log "Error removing existing publication: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Create-SnapshotAgent {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$ServerInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$SnapshotGenerationScript,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Create the snapshot agent job if we're not a merge publication
        $query = @"
EXEC sp_addpublication_snapshot
    @publication = N'$PublicationName',
    @frequency_type = 1 -- 1 = One time only
"@
        
        if ($PSCmdlet.ShouldProcess("$ServerInstance.$PublicationDB", "Create snapshot agent for publication: $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Creating snapshot agent for publication '$PublicationName'" `
                -LogErrorMessage "Failed to create snapshot agent"
            
            # If a custom snapshot script is specified, configure it
            if ($SnapshotGenerationScript) {
                if (Test-Path $SnapshotGenerationScript) {
                    $snapshotScriptPath = Resolve-Path $SnapshotGenerationScript
                    $snapshotScriptQuery = @"
EXEC sp_addscriptexec
    @publication = N'$PublicationName',
    @scriptname = N'Custom snapshot script',
    @scriptfile = N'$snapshotScriptPath',
    @skiperror = 0,
    @postsnapshotscript = 1
"@
                    
                    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Database $PublicationDB -Query $snapshotScriptQuery -SqlCredential $SqlCredential `
                        -LogMessage "Adding custom snapshot script for publication '$PublicationName'" `
                        -LogErrorMessage "Failed to add custom snapshot script"
                    
                    Write-Log "Added custom snapshot script: $snapshotScriptPath" -Level Info
                }
                else {
                    Write-Log "Custom snapshot script not found: $SnapshotGenerationScript" -Level Warning
                }
            }
            
            Write-Log "Successfully created snapshot agent for publication '$PublicationName'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating snapshot agent: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

# Main script execution
try {
    # Validate SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }
    
    # Check if database exists
    $dbExistsQuery = "SELECT COUNT(*) AS DbExists FROM sys.databases WHERE name = '$PublicationDB'"
    $dbExists = Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $dbExistsQuery -SqlCredential $SqlCredential `
        -LogMessage "Checking if database '$PublicationDB' exists" `
        -LogErrorMessage "Failed to check database existence"
    
    if ($dbExists.DbExists -eq 0) {
        throw "Database '$PublicationDB' does not exist on server '$ServerInstance'"
    }
    
    # Enable the database for publication
    $enablePublishingQuery = "EXEC sp_replicationdboption @dbname = N'$PublicationDB', @optname = N'publish', @value = N'true'"
    Invoke-SqlCmdWithLogging -ServerInstance $ServerInstance -Query $enablePublishingQuery -SqlCredential $SqlCredential `
        -LogMessage "Enabling database '$PublicationDB' for publication" `
        -LogErrorMessage "Failed to enable database for publication"
    
    # Check if publication already exists
    $pubInfo = Get-PublicationInfo -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
    
    if ($null -ne $pubInfo -and $pubInfo.Count -gt 0) {
        if ($Force) {
            Write-Log "Publication '$PublicationName' already exists. Removing it due to -Force parameter." -Level Warning
            
            # Remove the existing publication
            if (-not (Remove-ExistingPublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -ReplicationType $ReplicationType -SqlCredential $SqlCredential)) {
                throw "Failed to remove existing publication. Cannot proceed."
            }
        }
        else {
            Write-Log "Publication '$PublicationName' already exists. Use -Force to recreate it." -Level Warning
            exit 0
        }
    }
    
    # Create the publication based on the replication type
    $pubSuccess = $false
    switch ($ReplicationType) {
        "Snapshot" {
            $pubSuccess = New-SnapshotPublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -AllowAnonymousSubscribers $AllowAnonymousSubscribers -AllowPullSubscriptions $AllowPullSubscriptions -ImmediateSync $ImmediateSync `
                -SqlCredential $SqlCredential
        }
        "Transactional" {
            $pubSuccess = New-TransactionalPublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -AllowAnonymousSubscribers $AllowAnonymousSubscribers -AllowPullSubscriptions $AllowPullSubscriptions -ImmediateSync $ImmediateSync `
                -WithUpdatableSubscribers $false -SqlCredential $SqlCredential
        }
        "TransactionalWithUpdatableSubscribers" {
            $pubSuccess = New-TransactionalPublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -AllowAnonymousSubscribers $AllowAnonymousSubscribers -AllowPullSubscriptions $AllowPullSubscriptions -ImmediateSync $ImmediateSync `
                -WithUpdatableSubscribers $true -SqlCredential $SqlCredential
        }
        "PeerToPeer" {
            $pubSuccess = New-PeerToPeerPublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -SqlCredential $SqlCredential
        }
        "Merge" {
            $pubSuccess = New-MergePublication -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -AllowAnonymousSubscribers $AllowAnonymousSubscribers -AllowPullSubscriptions $AllowPullSubscriptions `
                -ConflictResolution $ConflictResolution -SqlCredential $SqlCredential
        }
    }
    
    if (-not $pubSuccess) {
        throw "Failed to create publication '$PublicationName' of type $ReplicationType"
    }
    
    # Add the articles to the publication
    if ($Articles -and $Articles.Count -gt 0) {
        if (-not (Add-Articles -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -ReplicationType $ReplicationType -Articles $Articles -FilterClauses $FilterClauses -SqlCredential $SqlCredential)) {
            throw "Failed to add articles to publication"
        }
    }
    
    # Create the snapshot agent (for non-merge publications)
    if ($ReplicationType -ne "Merge") {
        if (-not (Create-SnapshotAgent -ServerInstance $ServerInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -SnapshotGenerationScript $SnapshotGenerationScript -SqlCredential $SqlCredential)) {
            throw "Failed to create snapshot agent"
        }
    }
    
    Write-Log "Publication '$PublicationName' of type $ReplicationType created successfully in database '$PublicationDB'" -Level Success
}
catch {
    Write-Log "Error in Configure-Publication: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
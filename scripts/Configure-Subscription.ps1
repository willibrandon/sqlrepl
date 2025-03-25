<#
.SYNOPSIS
    Configures a SQL Server replication subscription to a publication.

.DESCRIPTION
    Sets up a subscription to a publication in SQL Server replication. Supports
    push and pull subscriptions to publications of all types (snapshot, transactional,
    merge, peer-to-peer, with updatable subscribers).

.PARAMETER PublisherInstance
    The SQL Server instance hosting the publisher database.

.PARAMETER PublicationDB
    The database containing the published data.

.PARAMETER PublicationName
    The name of the publication to subscribe to.

.PARAMETER SubscriberInstance
    The SQL Server instance that will host the subscription.

.PARAMETER SubscriptionDB
    The database on the subscriber instance that will receive the replicated data.

.PARAMETER SubscriptionType
    The type of subscription: Push (distribution agent runs at distributor) or 
    Pull (distribution agent runs at subscriber).

.PARAMETER SyncType
    How to initialize the subscription: Automatic (use snapshot), Replication Support Only,
    or Initialize From Backup.

.PARAMETER DistributorInstance
    If different from the publisher, specify the distributor instance.

.PARAMETER SubscriptionSecurity
    Authentication method for the subscription: WindowsAuthentication or SqlAuthentication.

.PARAMETER SubscriptionUser
    If using SQL Authentication for the subscription, the username.

.PARAMETER SubscriptionPassword
    If using SQL Authentication for the subscription, the password as SecureString.

.PARAMETER SqlCredential
    Optional: SQL authentication credentials for connecting to publisher/distributor.

.PARAMETER Force
    If a subscription already exists, Force will remove and recreate it.

.PARAMETER LogToEventLog
    Switch to enable logging to the Windows Event Log.

.PARAMETER LogToSqlTable
    Switch to enable logging to a SQL Server table.

.EXAMPLE
    .\Configure-Subscription.ps1 -PublisherInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "SalesPublication" -SubscriberInstance "SQLSERVER2\INSTANCE1" -SubscriptionDB "SalesDB_Sub" -SubscriptionType "Push"
    
    Creates a push subscription to SalesPublication on SQLSERVER2\INSTANCE1.

.EXAMPLE
    .\Configure-Subscription.ps1 -PublisherInstance "SQLSERVER1\INSTANCE1" -PublicationDB "SalesDB" -PublicationName "SalesPublication" -SubscriberInstance "SQLSERVER2\INSTANCE1" -SubscriptionDB "SalesDB_Sub" -SubscriptionType "Pull" -SyncType "InitializeFromBackup"
    
    Creates a pull subscription with initialization from backup.

.NOTES
    Version: 1.0
    Creation Date: 2023-03-25
    Author: DevOps Team
#>

[CmdletBinding(SupportsShouldProcess = $true)]
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
    [ValidateSet("Push", "Pull")]
    [string]$SubscriptionType = "Push",
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("Automatic", "ReplicationSupportOnly", "InitializeFromBackup")]
    [string]$SyncType = "Automatic",
    
    [Parameter(Mandatory = $false)]
    [string]$DistributorInstance,
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("WindowsAuthentication", "SqlAuthentication")]
    [string]$SubscriptionSecurity = "WindowsAuthentication",
    
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionUser,
    
    [Parameter(Mandatory = $false)]
    [System.Security.SecureString]$SubscriptionPassword,
    
    [Parameter(Mandatory = $false)]
    [System.Management.Automation.PSCredential]$SqlCredential,
    
    [Parameter(Mandatory = $false)]
    [switch]$Force,
    
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

# Validate parameters
if (-not $DistributorInstance) {
    $DistributorInstance = $PublisherInstance
}

if ($SubscriptionSecurity -eq "SqlAuthentication" -and (-not $SubscriptionUser -or -not $SubscriptionPassword)) {
    Write-Log "When using SQL Authentication for subscription, both SubscriptionUser and SubscriptionPassword must be provided" -Level Error -WriteToEventLog:$LogToEventLog
    throw "Missing required parameters for SQL Authentication"
}

function Get-ReplicationTypeFromPublication {
    [CmdletBinding()]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # First check if it's a merge publication
        $query = "USE [$PublicationDB]; IF EXISTS (SELECT 1 FROM [dbo].[sysmergepublications] WHERE name = '$PublicationName') SELECT 'Merge' AS ReplicationType; ELSE SELECT 'Transactional' AS ReplicationType"
        
        $result = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $query -SqlCredential $SqlCredential `
            -LogMessage "Determining replication type for publication '$PublicationName'" `
            -LogErrorMessage "Failed to determine replication type"
        
        return $result.ReplicationType
    }
    catch {
        Write-Log "Error determining replication type: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $null
    }
}

function Remove-ExistingSubscription {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$SubscriberInstance,
        [string]$SubscriptionDB,
        [string]$ReplicationType,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Check if we need to use merge procedure or regular
        $dropSubscriptionProc = if ($ReplicationType -eq "Merge") {
            "sp_dropmergesubscription"
        } else {
            "sp_dropsubscription"
        }
        
        # Drop the subscription
        $query = "USE [$PublicationDB]; EXEC $dropSubscriptionProc @publication = N'$PublicationName', @subscriber = N'$SubscriberInstance', @subscriber_db = N'$SubscriptionDB'"
        
        if ($PSCmdlet.ShouldProcess("$SubscriberInstance.$SubscriptionDB", "Drop existing subscription to $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Dropping existing subscription to '$PublicationName' on '$SubscriberInstance.$SubscriptionDB'" `
                -LogErrorMessage "Failed to drop existing subscription"
            
            Write-Log "Successfully dropped existing subscription" -Level Info
            return $true
        }
    }
    catch {
        Write-Log "Error removing existing subscription: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Add-TransactionalSubscription {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$SubscriberInstance,
        [string]$SubscriptionDB,
        [string]$SubscriptionType,
        [string]$SyncType,
        [string]$SubscriptionSecurity,
        [string]$SubscriptionUser,
        [System.Security.SecureString]$SubscriptionPassword,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Convert sync type to the appropriate value
        $syncTypeValue = switch ($SyncType) {
            "Automatic" { "automatic" }
            "ReplicationSupportOnly" { "replication support only" }
            "InitializeFromBackup" { "initialize from backup" }
            default { "automatic" }
        }
        
        # Add the subscription to the publication
        $query = @"
USE [$PublicationDB]
EXEC sp_addsubscription 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberInstance', 
    @destination_db = N'$SubscriptionDB', 
    @subscription_type = N'$(if ($SubscriptionType -eq "Push") { "push" } else { "pull" })', 
    @sync_type = N'$syncTypeValue', 
    @article = N'all'
"@
        
        if ($PSCmdlet.ShouldProcess("$SubscriberInstance.$SubscriptionDB", "Create transactional subscription to $PublicationName")) {
            Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $query -SqlCredential $SqlCredential `
                -LogMessage "Adding subscription to publication '$PublicationName' for subscriber '$SubscriberInstance.$SubscriptionDB'" `
                -LogErrorMessage "Failed to add subscription"
            
            # Now add the agent job (push or pull)
            if ($SubscriptionType -eq "Push") {
                # For push subscription, run on the publisher
                $securityMode = 1 # 1 = Windows Authentication, 0 = SQL Authentication
                $securityQuery = ""
                
                if ($SubscriptionSecurity -eq "SqlAuthentication") {
                    $securityMode = 0
                    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SubscriptionPassword)
                    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
                    
                    try {
                        $securityQuery = ", @subscriber_security_mode = $securityMode, @subscriber_login = N'$SubscriptionUser', @subscriber_password = N'$plainPassword'"
                    }
                    finally {
                        if ($BSTR) {
                            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
                        }
                    }
                }
                
                $pushQuery = @"
USE [$PublicationDB]
EXEC sp_addpushsubscription_agent 
    @publication = N'$PublicationName',
    @subscriber = N'$SubscriberInstance',
    @subscriber_db = N'$SubscriptionDB',
    @subscriber_security_mode = $securityMode$securityQuery,
    @job_login = NULL,
    @job_password = NULL,
    @frequency_type = 64,
    @frequency_interval = 0,
    @frequency_relative_interval = 0,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 0,
    @frequency_subday_interval = 0
"@
                
                Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $pushQuery -SqlCredential $SqlCredential `
                    -LogMessage "Creating push subscription agent for '$PublicationName'" `
                    -LogErrorMessage "Failed to create push subscription agent"
            }
            else {
                # For pull subscription, run on the subscriber
                $pullQuery = @"
USE [$SubscriptionDB]
EXEC sp_addpullsubscription_agent 
    @publisher = N'$PublisherInstance',
    @publisher_db = N'$PublicationDB',
    @publication = N'$PublicationName',
    @distributor = N'$DistributorInstance',
    @distributor_security_mode = 1,
    @frequency_type = 64,
    @frequency_interval = 0,
    @frequency_relative_interval = 0,
    @frequency_recurrence_factor = 0,
    @frequency_subday = 0,
    @frequency_subday_interval = 0
"@
                
                Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $pullQuery -SqlCredential $SqlCredential `
                    -LogMessage "Creating pull subscription agent for '$PublicationName'" `
                    -LogErrorMessage "Failed to create pull subscription agent"
            }
            
            Write-Log "Successfully created $SubscriptionType subscription for '$SubscriberInstance.$SubscriptionDB' to publication '$PublicationName'" -Level Success
            return $true
        }
    }
    catch {
        Write-Log "Error creating transactional subscription: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

function Add-MergeSubscription {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param (
        [string]$PublisherInstance,
        [string]$PublicationDB,
        [string]$PublicationName,
        [string]$SubscriberInstance,
        [string]$SubscriptionDB,
        [string]$SubscriptionType,
        [string]$SyncType,
        [string]$SubscriptionSecurity,
        [string]$SubscriptionUser,
        [System.Security.SecureString]$SubscriptionPassword,
        [System.Management.Automation.PSCredential]$SqlCredential
    )
    
    try {
        # Convert sync type to the appropriate value
        $syncTypeValue = switch ($SyncType) {
            "Automatic" { "automatic" }
            "ReplicationSupportOnly" { "replication support only" }
            "InitializeFromBackup" { "initialize from backup" }
            default { "automatic" }
        }
        
        # Security mode (1 = Windows Auth, 0 = SQL Auth)
        $securityMode = 1
        $securityQuery = ""
        
        if ($SubscriptionSecurity -eq "SqlAuthentication") {
            $securityMode = 0
            $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SubscriptionPassword)
            $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
            
            try {
                $securityQuery = ", @subscriber_security_mode = $securityMode, @subscriber_login = N'$SubscriptionUser', @subscriber_password = N'$plainPassword'"
            }
            finally {
                if ($BSTR) {
                    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
                }
            }
        }
        
        # Add the merge subscription
        if ($SubscriptionType -eq "Push") {
            $query = @"
USE [$PublicationDB]
EXEC sp_addmergesubscription 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberInstance', 
    @subscriber_db = N'$SubscriptionDB', 
    @subscription_type = N'push', 
    @sync_type = N'$syncTypeValue'$securityQuery
"@
            
            if ($PSCmdlet.ShouldProcess("$SubscriberInstance.$SubscriptionDB", "Create push merge subscription to $PublicationName")) {
                Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Adding merge push subscription to '$PublicationName' for '$SubscriberInstance.$SubscriptionDB'" `
                    -LogErrorMessage "Failed to add merge push subscription"
                
                # Create push agent
                $pushAgentQuery = @"
USE [$PublicationDB]
EXEC sp_addmergepushsubscription_agent 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberInstance', 
    @subscriber_db = N'$SubscriptionDB', 
    @subscriber_security_mode = $securityMode$securityQuery,
    @frequency_type = 64, 
    @frequency_interval = 0, 
    @frequency_relative_interval = 0, 
    @frequency_recurrence_factor = 0, 
    @frequency_subday = 0, 
    @frequency_subday_interval = 0
"@
                
                Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $pushAgentQuery -SqlCredential $SqlCredential `
                    -LogMessage "Creating merge push subscription agent for '$PublicationName'" `
                    -LogErrorMessage "Failed to create merge push subscription agent"
            }
        }
        else {
            # Pull subscription
            $query = @"
USE [$PublicationDB]
EXEC sp_addmergesubscription 
    @publication = N'$PublicationName', 
    @subscriber = N'$SubscriberInstance', 
    @subscriber_db = N'$SubscriptionDB', 
    @subscription_type = N'pull', 
    @sync_type = N'$syncTypeValue'
"@
            
            if ($PSCmdlet.ShouldProcess("$SubscriberInstance.$SubscriptionDB", "Create pull merge subscription to $PublicationName")) {
                Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $query -SqlCredential $SqlCredential `
                    -LogMessage "Adding merge pull subscription to '$PublicationName' for '$SubscriberInstance.$SubscriptionDB'" `
                    -LogErrorMessage "Failed to add merge pull subscription"
                
                # Create pull agent on subscriber
                $pullAgentQuery = @"
USE [$SubscriptionDB]
EXEC sp_addmergepullsubscription_agent 
    @publisher = N'$PublisherInstance', 
    @publisher_db = N'$PublicationDB', 
    @publication = N'$PublicationName',
    @distributor = N'$DistributorInstance',
    @distributor_security_mode = 1,
    @frequency_type = 64, 
    @frequency_interval = 0, 
    @frequency_relative_interval = 0, 
    @frequency_recurrence_factor = 0, 
    @frequency_subday = 0, 
    @frequency_subday_interval = 0
"@
                
                Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $pullAgentQuery -SqlCredential $SqlCredential `
                    -LogMessage "Creating merge pull subscription agent for '$PublicationName'" `
                    -LogErrorMessage "Failed to create merge pull subscription agent"
            }
        }
        
        Write-Log "Successfully created $SubscriptionType merge subscription for '$SubscriberInstance.$SubscriptionDB' to publication '$PublicationName'" -Level Success
        return $true
    }
    catch {
        Write-Log "Error creating merge subscription: $_" -Level Error -WriteToEventLog:$LogToEventLog
        return $false
    }
}

# Main script execution
try {
    # Validate SQL connections to publisher and subscriber
    if (-not (Test-SqlConnection -ServerInstance $PublisherInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to publisher SQL Server instance '$PublisherInstance'"
    }
    
    if (-not (Test-SqlConnection -ServerInstance $SubscriberInstance -SqlCredential $SqlCredential)) {
        throw "Failed to connect to subscriber SQL Server instance '$SubscriberInstance'"
    }
    
    # Check if publication exists
    $pubInfo = Get-PublicationInfo -ServerInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
    
    if ($null -eq $pubInfo -or $pubInfo.Count -eq 0) {
        throw "Publication '$PublicationName' does not exist in database '$PublicationDB' on server '$PublisherInstance'"
    }
    
    # Determine replication type (merge or transactional/snapshot)
    $replicationType = Get-ReplicationTypeFromPublication -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName -SqlCredential $SqlCredential
    
    if (-not $replicationType) {
        throw "Could not determine replication type for publication '$PublicationName'"
    }
    
    Write-Log "Detected $replicationType replication for publication '$PublicationName'" -Level Info
    
    # Check if subscriber database exists
    $subDbExistsQuery = "SELECT COUNT(*) AS DbExists FROM sys.databases WHERE name = '$SubscriptionDB'"
    $subDbExists = Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $subDbExistsQuery -SqlCredential $SqlCredential `
        -LogMessage "Checking if subscriber database '$SubscriptionDB' exists" `
        -LogErrorMessage "Failed to check subscriber database existence"
    
    if ($subDbExists.DbExists -eq 0) {
        Write-Log "Subscriber database '$SubscriptionDB' does not exist. Creating it..." -Level Warning
        $createDbQuery = "CREATE DATABASE [$SubscriptionDB]"
        
        Invoke-SqlCmdWithLogging -ServerInstance $SubscriberInstance -Query $createDbQuery -SqlCredential $SqlCredential `
            -LogMessage "Creating subscriber database '$SubscriptionDB'" `
            -LogErrorMessage "Failed to create subscriber database"
    }
    
    # Check if subscription already exists and handle accordingly
    $getSubQuery = "USE [$PublicationDB]; EXEC sp_helpsubscription @publication = N'$PublicationName', @subscriber = N'$SubscriberInstance', @destination_db = N'$SubscriptionDB'"
    $existingSub = $null
    
    try {
        $existingSub = Invoke-SqlCmdWithLogging -ServerInstance $PublisherInstance -Query $getSubQuery -SqlCredential $SqlCredential `
            -LogMessage "Checking if subscription already exists" `
            -LogErrorMessage "Failed to check existing subscription"
    }
    catch {
        # Error is expected if the subscription doesn't exist
        $existingSub = $null
    }
    
    if ($null -ne $existingSub -and $existingSub.Count -gt 0) {
        if ($Force) {
            Write-Log "Subscription for '$SubscriberInstance.$SubscriptionDB' already exists. Removing it due to -Force parameter." -Level Warning
            
            # Remove the existing subscription
            if (-not (Remove-ExistingSubscription -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                    -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -ReplicationType $replicationType -SqlCredential $SqlCredential)) {
                throw "Failed to remove existing subscription. Cannot proceed."
            }
        }
        else {
            Write-Log "Subscription for '$SubscriberInstance.$SubscriptionDB' already exists. Use -Force to recreate it." -Level Warning
            exit 0
        }
    }
    
    # Create the appropriate subscription based on replication type
    if ($replicationType -eq "Merge") {
        if (-not (Add-MergeSubscription -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -SubscriptionType $SubscriptionType -SyncType $SyncType `
                -SubscriptionSecurity $SubscriptionSecurity -SubscriptionUser $SubscriptionUser -SubscriptionPassword $SubscriptionPassword -SqlCredential $SqlCredential)) {
            throw "Failed to create merge subscription"
        }
    }
    else {
        # Transactional or snapshot replication
        if (-not (Add-TransactionalSubscription -PublisherInstance $PublisherInstance -PublicationDB $PublicationDB -PublicationName $PublicationName `
                -SubscriberInstance $SubscriberInstance -SubscriptionDB $SubscriptionDB -SubscriptionType $SubscriptionType -SyncType $SyncType `
                -SubscriptionSecurity $SubscriptionSecurity -SubscriptionUser $SubscriptionUser -SubscriptionPassword $SubscriptionPassword -SqlCredential $SqlCredential)) {
            throw "Failed to create transactional/snapshot subscription"
        }
    }
    
    Write-Log "Subscription configuration completed successfully" -Level Success
}
catch {
    Write-Log "Error in Configure-Subscription: $($_.Exception.Message)" -Level Error -WriteToEventLog:$LogToEventLog -WriteToSqlTable:$LogToSqlTable
    exit 1
} 
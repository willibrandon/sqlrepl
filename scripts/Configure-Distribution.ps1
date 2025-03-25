[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$ServerInstance,

    [Parameter(Mandatory = $true)]
    [string]$DistributionDB = "distribution",

    [Parameter(Mandatory = $false)]
    [string]$SnapshotFolder = "\\$ServerInstance\Repldata",

    [Parameter(Mandatory = $false)]
    [int]$DistributionRetention = 72,

    [Parameter(Mandatory = $false)]
    [int]$HistoryRetention = 48,

    [Parameter(Mandatory = $false)]
    [string]$RemoteDistributor,

    [Parameter(Mandatory = $false)]
    [System.Security.SecureString]$DistributorPassword,

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

function Test-Distributor {
    param (
        [string]$ServerInstance,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        $query = "EXEC sp_get_distributor"
        if ($Credential) {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }
        return $result
    }
    catch {
        Write-Log "Error checking distributor status: $_"
        return $null
    }
}

function Install-LocalDistributor {
    param (
        [string]$ServerInstance,
        [string]$DistributionDB,
        [string]$SnapshotFolder,
        [int]$DistributionRetention,
        [int]$HistoryRetention,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
        # Install the distributor
        $query = "EXEC sp_adddistributor @distributor = N'$ServerInstance'"
        
        if ($Credential) {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }

        # Create the distribution database
        $query = @"
        EXEC sp_adddistributiondb 
            @database = N'$DistributionDB',
            @data_folder = N'$(Get-SqlDefaultDataPath -ServerInstance $ServerInstance)',
            @data_file = N'$DistributionDB',
            @data_file_size = 10,
            @log_folder = N'$(Get-SqlDefaultLogPath -ServerInstance $ServerInstance)',
            @log_file = N'$($DistributionDB)_log',
            @log_file_size = 5,
            @min_distretention = 0,
            @max_distretention = $DistributionRetention,
            @history_retention = $HistoryRetention,
            @security_mode = 1
"@
        
        if ($Credential) {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }

        # Configure the distribution publisher
        $query = @"
        EXEC sp_adddistpublisher 
            @publisher = N'$ServerInstance',
            @distribution_db = N'$DistributionDB',
            @working_directory = N'$SnapshotFolder',
            @security_mode = 1,
            @trusted = N'false'
"@

        if ($Credential) {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query -ErrorAction Stop
        }

        Write-Log "Successfully configured local distributor on '$ServerInstance'"
        return $true
    }
    catch {
        Write-Log "Error configuring local distributor: $_"
        return $false
    }
}

# Add helper function to get SQL Server default paths
function Get-SqlDefaultDataPath {
    param([string]$ServerInstance)
    $query = "SELECT SERVERPROPERTY('InstanceDefaultDataPath') as DataPath"
    $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query
    return $result.DataPath
}

function Get-SqlDefaultLogPath {
    param([string]$ServerInstance)
    $query = "SELECT SERVERPROPERTY('InstanceDefaultLogPath') as LogPath"
    $result = Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $query
    return $result.LogPath
}

function Install-RemoteDistributor {
    param (
        [string]$ServerInstance,
        [string]$RemoteDistributor,
        [System.Security.SecureString]$DistributorPassword,
        [string]$DistributionDB,
        [string]$SnapshotFolder,
        [System.Management.Automation.PSCredential]$Credential
    )
    try {
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

        if ($Credential) {
            Invoke-Sqlcmd -ServerInstance $RemoteDistributor -Query $query -Credential $Credential -ErrorAction Stop
        }
        else {
            Invoke-Sqlcmd -ServerInstance $RemoteDistributor -Query $query -ErrorAction Stop
        }

        Write-Log "Successfully configured remote distributor '$RemoteDistributor' for publisher '$ServerInstance'"
        return $true
    }
    catch {
        Write-Log "Error configuring remote distributor: $_"
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
    # Import required module
    Import-Module SQLPS -DisableNameChecking -ErrorAction Stop

    # Test SQL connection
    if (-not (Test-SqlConnection -ServerInstance $ServerInstance -Credential $SqlCredential)) {
        throw "Failed to connect to SQL Server instance '$ServerInstance'"
    }

    # Check current distributor status
    $distributorStatus = Test-Distributor -ServerInstance $ServerInstance -Credential $SqlCredential
    if ($null -eq $distributorStatus) {
        throw "Failed to check distributor status"
    }

    if ($distributorStatus.installed -eq 1) {
        Write-Log "Distribution is already configured on '$ServerInstance'"
        exit 0
    }

    # Configure distribution based on whether it's local or remote
    if ($RemoteDistributor) {
        if (-not $DistributorPassword) {
            throw "DistributorPassword is required when configuring a remote distributor"
        }
        
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
}
catch {
    Write-Log "Error: $_"
    exit 1
} 
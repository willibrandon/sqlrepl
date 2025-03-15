# Command Reference

This guide lists all available commands in the SQL Replication Extension for VS Code. Commands can be accessed through:
- The Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
- Context menus in the SQL Replication view
- Toolbar buttons

## Server Management

### Add SQL Server Connection
- **Command ID**: `sqlrepl.addConnection`
- **Icon**: ➕
- **Description**: Add a new SQL Server instance to manage replication
- **Access**: 
  - Command Palette
  - SQL Replication view toolbar
- **Options**:
  - Server name
  - Authentication type (Windows/SQL)
  - Credentials (for SQL authentication)
  - Database name (optional)

### Remove Server
- **Command ID**: `sqlrepl.removeServer`
- **Icon**: 🗑️
- **Description**: Remove a SQL Server connection from the extension
- **Access**: Server context menu
- **Confirmation**: Required before removal

### Disable Publishing and Distribution
- **Command ID**: `sqlrepl.removeReplication`
- **Icon**: 🗑️
- **Description**: Remove all replication configuration from a server
- **Access**: Server context menu
- **Confirmation**: Required before removal
- **Effects**:
  - Removes all publications
  - Drops distribution database
  - Disables distribution

## Publication Management

### Create Publication
- **Command ID**: `sqlrepl.createPublication`
- **Icon**: ➕
- **Description**: Create a new replication publication
- **Access**: Publications folder context menu
- **Options**:
  - Publication type (Snapshot/Transactional)
  - Database selection
  - Article selection
  - Snapshot folder location
  - Security settings

## Subscription Management

### Create Subscription
- **Command ID**: `sqlrepl.createSubscription`
- **Icon**: ➕
- **Description**: Create a new subscription to a publication
- **Access**: 
  - Publication context menu
  - Subscriptions folder context menu
- **Options**:
  - Subscription type (Push/Pull)
  - Subscriber database
  - Synchronization options
  - Security settings

### Reinitialize Subscription
- **Command ID**: `sqlrepl.reinitializeSubscription`
- **Icon**: 🔄
- **Description**: Reinitialize an existing subscription
- **Access**: Subscription context menu
- **Options**:
  - Synchronization type
  - Snapshot application

### Drop Subscription
- **Command ID**: `sqlrepl.dropSubscription`
- **Icon**: 🗑️
- **Description**: Remove an existing subscription
- **Access**: Subscription context menu
- **Confirmation**: Required before removal

## Agent Management

### Start Agent
- **Command ID**: `sqlrepl.startAgent`
- **Icon**: ▶️
- **Description**: Start a replication agent job
- **Access**: Agent context menu (when stopped)
- **Applies to**:
  - Snapshot Agent
  - Log Reader Agent
  - Distribution Agent

### Stop Agent
- **Command ID**: `sqlrepl.stopAgent`
- **Icon**: ⏹️
- **Description**: Stop a running replication agent job
- **Access**: Agent context menu (when running)
- **Confirmation**: Required before stopping
- **Applies to**:
  - Snapshot Agent
  - Log Reader Agent
  - Distribution Agent

### View Agent History
- **Command ID**: `sqlrepl.viewAgentHistory`
- **Icon**: 📋
- **Description**: View detailed agent job history
- **Access**: Agent context menu
- **Information shown**:
  - Execution times
  - Status
  - Error messages
  - Duration
  - Step details

## General Commands

### Refresh View
- **Command ID**: `sqlrepl.refreshTree`
- **Icon**: 🔄
- **Description**: Refresh the SQL Replication view
- **Access**: 
  - SQL Replication view toolbar
  - Command Palette
- **Updates**:
  - Server status
  - Publication list
  - Subscription status
  - Agent status

### Show Welcome Message
- **Command ID**: `sqlrepl.showWelcomeMessage`
- **Description**: Display the extension's welcome message
- **Access**: Command Palette
- **Content**:
  - Quick start guide
  - Feature overview
  - Documentation links

## Keyboard Shortcuts

The extension uses VS Code's standard keyboard shortcut system. You can customize these in your keyboard shortcuts settings:

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "Preferences: Open Keyboard Shortcuts"
3. Search for "SQL Replication"
4. Customize shortcuts as needed

## Context Menu Reference

Different commands are available depending on the context:

### Server Node
- Add Connection
- Remove Server
- Disable Publishing and Distribution
- Refresh

### Publications Folder
- Create Publication
- Refresh

### Publication Node
- Create Subscription
- Refresh

### Subscriptions Folder
- Create Subscription
- Refresh

### Subscription Node
- Reinitialize Subscription
- Drop Subscription
- Refresh

### Agent Node
- Start/Stop Agent
- View History
- Refresh

## Command Line Interface

The extension also supports command-line operations through VS Code's built-in terminal:

```bash
# Open VS Code with SQL Replication view
code --command "workbench.view.extension.replicationExplorer"

# Add a new connection (requires user interaction)
code --command "sqlrepl.addConnection"

# Refresh the replication view
code --command "sqlrepl.refreshTree"
```

# Getting Started

This guide will help you get up and running with the SQL Replication Extension for VS Code.

## Installation

1. Open VS Code
2. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (macOS)
3. Type `ext install sqlrepl`
4. Click "Install"

## Prerequisites

Before using the extension, ensure you have:

- SQL Server 2016 or higher installed
- Appropriate permissions to configure replication
- SQL Server Agent running on your instance

## First Steps

1. **Open the SQL Replication View**
   - Click the SQL Replication icon in the Activity Bar
   - Or use the command palette (`Ctrl+Shift+P`) and type "SQL Replication: Show Explorer"

2. **Add a Connection**
   - Click the "+" button in the SQL Replication view
   - Enter your server details:
     ```
     Server: your-server-name
     Authentication: SQL Server or Windows
     Username: your-username (if using SQL Server auth)
     Password: your-password (if using SQL Server auth)
     ```

3. **Configure Distributor**
   - Right-click your server in the tree view
   - Select "Configure Distribution"
   - Follow the wizard to set up distribution

## Next Steps

- Learn how to [create publications](publications.md)
- Set up [subscriptions](subscriptions.md)
- Monitor your [replication status](monitoring.md)

## Troubleshooting

If you encounter any issues:

1. Check the Output panel (`Ctrl+Shift+U`) and select "SQL Replication" from the dropdown
2. Verify SQL Server Agent is running
3. Ensure you have appropriate permissions
4. See our [troubleshooting guide](../advanced/troubleshooting.md) for more help

## Need Help?

- Check our [documentation](https://willibrandon.github.io/sqlrepl)
- File issues on [GitHub](https://github.com/willibrandon/sqlrepl/issues)

# Managing Publications

This guide covers how to create and manage SQL Server replication publications using the SQL Replication Extension.

## Understanding Publications

A publication is a collection of articles (tables, stored procedures, etc.) that you want to replicate to other databases. The SQL Replication Extension supports two types of publications:

- **Snapshot Publications**: Create a complete copy of all articles at a specific point in time
- **Transactional Publications**: Continuously replicate changes from the publisher to subscribers

## Creating a Publication

1. **Access the Publications View**
   - Expand your server in the SQL Replication view
   - Right-click the "Publications" folder
   - Select "Create Publication"

2. **Configure Distribution**
   If distribution isn't configured yet, the extension will guide you through setting it up:
   - Choose a distribution database name (default: "distribution")
   - Specify a working directory for snapshot files
   - Configure security settings

3. **Choose Publication Type**
   Select either:
   - **Snapshot**: For periodic full data synchronization
   - **Transactional**: For continuous change replication

4. **Name Your Publication**
   - Enter a unique name for your publication
   - Select the database containing the articles to publish

5. **Select Articles**
   - Choose the tables you want to replicate
   - The extension automatically filters out system tables

## Managing Existing Publications

### Viewing Publications
- Expand your server in the SQL Replication view
- Open the "Publications" folder to see all publications
- Click on a publication to view its properties

### Monitoring Status
- Check the status indicators next to each publication
- View agent jobs associated with the publication
- Access detailed agent history and logs

### Common Tasks
- **Start/Stop Agents**: Use the play/stop buttons next to agent items
- **View History**: Click the history icon to see detailed agent logs
- **Add Subscriptions**: Right-click a publication to add subscribers

## Best Practices

1. **Naming Conventions**
   - Use descriptive names for publications
   - Include the type (snapshot/transactional) in the name
   - Consider including the database name for clarity

2. **Performance Considerations**
   - Limit the number of articles to what's necessary
   - Consider table size when choosing publication type
   - Monitor snapshot folder disk space

3. **Security**
   - Use Windows Authentication when possible
   - Create dedicated service accounts for replication
   - Regularly review permissions

4. **Maintenance**
   - Monitor agent status regularly
   - Set up alerts for failed jobs
   - Keep snapshot folder clean

## Troubleshooting

### Common Issues

1. **Publication Creation Fails**
   - Verify distribution is properly configured
   - Check SQL Server Agent is running
   - Ensure sufficient permissions

2. **Snapshot Generation Issues**
   - Verify snapshot folder permissions
   - Check available disk space
   - Review agent job history

3. **Article Access Errors**
   - Verify schema permissions
   - Check for schema changes
   - Review article properties

### Getting Help

If you encounter issues:
1. Check the Output panel for detailed error messages
2. Review the [troubleshooting guide](../advanced/troubleshooting.md)
3. Search or file issues on [GitHub](https://github.com/willibrandon/sqlrepl/issues)

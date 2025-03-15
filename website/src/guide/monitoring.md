# Monitoring Replication

This guide covers how to monitor SQL Server replication health and performance using the SQL Replication Extension.

## Understanding Replication Agents

The extension helps you monitor different types of replication agents:

1. **Snapshot Agent**
   - Creates initial data snapshots
   - Runs periodically for snapshot publications
   - Critical for initial synchronization

2. **Log Reader Agent**
   - Monitors transaction log for changes
   - Moves transactions to distribution database
   - Essential for transactional replication

3. **Distribution Agent**
   - Moves transactions from distributor to subscribers
   - Handles data delivery and conflict resolution
   - Key for maintaining synchronization

## Monitoring Tools

### Agent Status View
- Expand a server in the SQL Replication view
- Check agent status indicators:
  - ▶️ Running
  - ⏹️ Stopped
  - ⚠️ Failed
  - 🔄 In Progress

### Agent History
1. Click the history icon next to any agent
2. View detailed execution logs:
   - Run times
   - Status messages
   - Error details
   - Duration information

### Performance Monitoring
- Monitor agent execution times
- Track synchronization latency
- View error rates and patterns

## Common Monitoring Tasks

### Checking Agent Status
1. Open the SQL Replication view
2. Expand your server
3. Look for status indicators
4. Start/stop agents as needed

### Viewing Job History
1. Click the history icon
2. Review recent executions
3. Check for errors or warnings
4. Analyze performance patterns

### Troubleshooting Issues
1. Check agent status
2. Review error messages
3. Examine job history
4. Monitor system resources

## Best Practices

### Regular Monitoring
1. **Check Agent Status Daily**
   - Verify all agents are running
   - Look for warning signs
   - Address issues promptly

2. **Review Performance Metrics**
   - Monitor latency
   - Check resource usage
   - Track error rates

3. **Maintain History**
   - Keep sufficient history
   - Archive important logs
   - Document issues and solutions

### Setting Up Alerts

1. **Agent Failures**
   - Monitor agent status
   - Set up email notifications
   - Define escalation procedures

2. **Performance Issues**
   - Track synchronization delays
   - Monitor resource usage
   - Set thresholds for alerts

3. **Error Patterns**
   - Look for recurring issues
   - Track error frequencies
   - Identify root causes

## Troubleshooting

### Common Issues

1. **Agent Not Starting**
   - Check SQL Server Agent status
   - Verify service account permissions
   - Review error logs

2. **Synchronization Delays**
   - Check network connectivity
   - Monitor system resources
   - Review agent job history

3. **Performance Problems**
   - Check for blocking processes
   - Monitor disk space
   - Review network latency

### Getting Help

If you need assistance:
1. Check the Output panel for detailed logs
2. Review our [troubleshooting guide](../advanced/troubleshooting.md)
3. File issues on [GitHub](https://github.com/willibrandon/sqlrepl/issues)

## Advanced Monitoring

### Using System Views
The extension provides access to key system views:
- Distribution agent history
- Log reader agent history
- Snapshot agent history
- Replication performance metrics

### Custom Monitoring
- Set up custom monitoring schedules
- Configure specific metrics to track
- Create custom alert thresholds

### Performance Optimization
- Monitor resource usage
- Track synchronization times
- Identify bottlenecks
- Optimize agent schedules

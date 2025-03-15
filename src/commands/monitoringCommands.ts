import * as vscode from 'vscode';
import { MonitoringDashboard } from '../features/monitoringDashboard';

/**
 * Registers all monitoring-related commands.
 * 
 * @param context - VSCode extension context
 */
export function registerMonitoringCommands(context: vscode.ExtensionContext): void {
    // Register command to show monitoring dashboard
    context.subscriptions.push(
        vscode.commands.registerCommand('sqlrepl.showMonitoringDashboard', () => {
            MonitoringDashboard.getInstance().show();
        })
    );
} 
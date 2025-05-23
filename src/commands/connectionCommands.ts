import * as vscode from 'vscode';
import { ConnectionService, SqlServerConnection } from '../services/connectionService';
import { v4 as uuidv4 } from 'uuid';
import { SqlService } from '../services/sqlService';

/**
 * Manages VS Code commands related to SQL Server connections.
 * Provides functionality to add and manage server connections in the extension.
 */
export class ConnectionCommands {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Registers all connection-related commands with VS Code.
     * Currently supports adding new server connections.
     */
    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.addConnection', () => this.addConnection())
        );
    }

    /**
     * Handles the process of adding a new SQL Server connection.
     * Prompts user for:
     * - Server name
     * - Authentication type (Windows or SQL Server)
     * - Credentials (if using SQL Server authentication)
     * - Optional database name
     * 
     * Creates and stores the connection, then refreshes the tree view.
     * Shows appropriate error messages if the process fails.
     */
    private async addConnection(): Promise<void> {
        try {
            // Get server name
            const serverName = await vscode.window.showInputBox({
                prompt: 'Enter SQL Server instance name',
                placeHolder: 'e.g., localhost or server.domain.com',
                validateInput: text => {
                    return text ? null : 'Server name is required';
                }
            });

            if (!serverName) {
                return; // User cancelled
            }

            // Choose authentication type
            const authType = await vscode.window.showQuickPick(
                [
                    { label: 'Windows Authentication', value: 'windows' },
                    { label: 'SQL Server Authentication', value: 'sql' }
                ],
                {
                    placeHolder: 'Select authentication type'
                }
            );

            if (!authType) {
                return; // User cancelled
            }

            let username: string | undefined;
            let password: string | undefined;

            if (authType.value === 'sql') {
                // Get SQL credentials
                username = await vscode.window.showInputBox({
                    prompt: 'Enter SQL Server username',
                    validateInput: text => {
                        return text ? null : 'Username is required for SQL Server authentication';
                    }
                });

                if (!username) {
                    return; // User cancelled
                }

                password = await vscode.window.showInputBox({
                    prompt: 'Enter SQL Server password',
                    password: true,
                    validateInput: text => {
                        return text ? null : 'Password is required for SQL Server authentication';
                    }
                });

                if (!password) {
                    return; // User cancelled
                }
            }

            // Get optional database name
            const database = await vscode.window.showInputBox({
                prompt: 'Enter database name (optional)',
                placeHolder: 'master'
            });

            // Create connection object
            const connection: SqlServerConnection = {
                id: uuidv4(),
                serverName,
                authentication: authType.value as 'windows' | 'sql',
                username,
                password,
                database
            };

            // Store connection
            const connectionService = ConnectionService.getInstance(this.context);
            const newConnection = connectionService.addConnection(connection);

            // Show success message
            vscode.window.showInformationMessage(`Successfully added connection to ${serverName}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

            // Test the connection and detect OS type
            const sqlService = SqlService.getInstance();
            await sqlService.testConnection(newConnection);
            
            // Refresh the tree view again to show the OS-specific icon
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 
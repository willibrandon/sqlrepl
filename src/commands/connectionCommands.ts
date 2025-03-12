import * as vscode from 'vscode';
import { ConnectionService, SqlServerConnection } from '../services/connectionService';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionCommands {
    constructor(private context: vscode.ExtensionContext) {}

    public registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('sqlrepl.addConnection', () => this.addConnection())
        );
    }

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
                database
            };

            // Store connection
            await ConnectionService.getInstance(this.context).addConnection(connection);

            // Show success message
            vscode.window.showInformationMessage(`Successfully added connection to ${serverName}`);

            // Refresh the tree view
            await vscode.commands.executeCommand('sqlrepl.refreshTree');

            // TODO: Validate connection (will be implemented when we add SQL client)

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 
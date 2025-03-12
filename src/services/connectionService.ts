import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

export interface SqlServerConnection {
    id: string;
    serverName: string;
    database?: string;
    authentication: 'windows' | 'sql';
    username?: string;
    password?: string;
}

export class ConnectionService {
    private static instance: ConnectionService;
    private connections: SqlServerConnection[];

    private constructor(private context: vscode.ExtensionContext) {
        this.connections = this.loadConnections();
    }

    public static getInstance(context?: vscode.ExtensionContext): ConnectionService {
        if (!ConnectionService.instance) {
            if (!context) {
                throw new Error('Context must be provided when creating ConnectionService instance');
            }
            ConnectionService.instance = new ConnectionService(context);
        }
        return ConnectionService.instance;
    }

    private loadConnections(): SqlServerConnection[] {
        return this.context.globalState.get<SqlServerConnection[]>('sqlConnections', []);
    }

    private saveConnections(): void {
        this.context.globalState.update('sqlConnections', this.connections);
    }

    public getConnections(): SqlServerConnection[] {
        return [...this.connections];
    }

    public getConnection(id: string): SqlServerConnection | undefined {
        return this.connections.find(conn => conn.id === id);
    }

    public addConnection(connection: Omit<SqlServerConnection, 'id'>): SqlServerConnection {
        const newConnection: SqlServerConnection = {
            ...connection,
            id: uuidv4()
        };
        this.connections.push(newConnection);
        this.saveConnections();
        return newConnection;
    }

    public removeConnection(id: string): void {
        this.connections = this.connections.filter(conn => conn.id !== id);
        this.saveConnections();
    }

    public updateConnection(id: string, connection: Partial<SqlServerConnection>): SqlServerConnection {
        const index = this.connections.findIndex(conn => conn.id === id);
        if (index === -1) {
            throw new Error(`Connection with id ${id} not found`);
        }

        this.connections[index] = {
            ...this.connections[index],
            ...connection
        };
        this.saveConnections();
        return this.connections[index];
    }
} 
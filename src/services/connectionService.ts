import * as vscode from 'vscode';

export interface SqlServerConnection {
    id: string;
    serverName: string;
    authentication: 'windows' | 'sql';
    username?: string;
    database?: string;
}

export class ConnectionService {
    private static instance: ConnectionService;
    private connections: Map<string, SqlServerConnection>;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.connections = new Map<string, SqlServerConnection>();
        this.context = context;
        this.loadConnections();
    }

    public static getInstance(context: vscode.ExtensionContext): ConnectionService {
        if (!ConnectionService.instance) {
            ConnectionService.instance = new ConnectionService(context);
        }
        return ConnectionService.instance;
    }

    private async loadConnections() {
        const storedConnections = await this.context.secrets.get('sqlConnections');
        if (storedConnections) {
            const parsed = JSON.parse(storedConnections);
            parsed.forEach((conn: SqlServerConnection) => {
                this.connections.set(conn.id, conn);
            });
        }
    }

    private async saveConnections() {
        const connectionsArray = Array.from(this.connections.values());
        await this.context.secrets.store('sqlConnections', JSON.stringify(connectionsArray));
    }

    public async addConnection(connection: SqlServerConnection): Promise<void> {
        this.connections.set(connection.id, connection);
        await this.saveConnections();
    }

    public async removeConnection(id: string): Promise<void> {
        this.connections.delete(id);
        await this.saveConnections();
    }

    public getConnections(): SqlServerConnection[] {
        return Array.from(this.connections.values());
    }

    public getConnection(id: string): SqlServerConnection | undefined {
        return this.connections.get(id);
    }
} 
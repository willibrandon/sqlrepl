Below is a **step-by-step implementation guide** that follows the updated design document for building a **SQL Server Replication Extension** in **Visual Studio Code**. Each stage is broken into **small, logical chunks** to help maintain focus. At the end of each chunk, there is a **verification/testing step** and an instruction to **commit** your changes to version control before moving on.

---

# **SQL Server Replication Extension for VS Code: Implementation Guide**

## Overview

1. **Repository Setup**  
2. **Extension Scaffolding & Basic Structure**  
3. **Connection Management**  
4. **Replication Explorer: Basic Tree View**  
5. **Publication Creation (Snapshot & Transactional MVP)**  
6. **Subscription Management**  
7. **Agent & Job Management**  
8. **Monitoring Dashboard & Alerts**  
9. **Advanced Replication Features (Merge, Peer-to-Peer)**  
10. **Security & Permission Handling**  
11. **Testing, CI/CD, and Publishing**  
12. **Performance Tuning & Final Polishing**

Each chunk below references relevant design document sections for quick cross-checking.

---

## 1. Repository Setup

### Goals
- Create a new GitHub repository (e.g., `sqlrepl`).
- Initialize the project structure.

### Tasks
1. **Create GitHub Repository**  
   - Name it `sqlrepl` (or your chosen name).  
   - Add a standard `.gitignore` for Node/TypeScript projects.

2. **Clone Locally & Initialize**  
   - Clone the repo to your local machine.  
   - Run `npm init` (or `yarn init`) to start your package setup.

3. **File/Folder Setup** (reference the design doc, Section 3: Architecture)  
   - Create these folders in your root:
     ```
     /src
     /src/commands
     /src/features
     /src/services
     /test
     /media   (for images, icons, etc.)
     ```
   - Prepare a basic `README.md` describing the project goal.

4. **Add License & Code of Conduct** (optional but recommended)  
   - If open sourcing, include an MIT or Apache 2.0 license.  
   - Add a CONTRIBUTING.md if you plan community involvement.

### Verification, Testing & Commit
- **Verify**: Ensure `npm install` completes without errors; confirm you have a `package.json`, `.gitignore`, and placeholders for folders.  
- **Test**: For now, just confirm everything is in place. No functional code yet.  
- **Git Commit**:  
  ```
  git add .
  git commit -m "Initial project setup with folder structure"
  git push
  ```

---

## 2. Extension Scaffolding & Basic Structure

### Goals
- Scaffold a VS Code extension using the TypeScript extension pattern.
- Add core extension files (`extension.ts`, `package.json` with extension fields).

### Tasks
1. **Install VS Code Extension Dependencies**  
   - `npm install -D typescript @types/node @types/vscode vsce vscode-test`

2. **Create Extension Entry Point**  
   - In `/src/extension.ts`, add boilerplate `activate` and `deactivate` functions:
     ```ts
     import * as vscode from 'vscode';

     export function activate(context: vscode.ExtensionContext) {
       // Activation logic
       console.log('SQL Server Replication Extension activated');
     }

     export function deactivate() {
       // Cleanup if needed
     }
     ```

3. **Update `package.json`** for Extension Configuration  
   - Under `contributes`, define your extension points (will be refined later):
     ```json
     {
       "name": "sql-server-replication-extension",
       "displayName": "SQL Server Replication Manager",
       "description": "Manage SQL Server Replication directly from VS Code",
       "version": "0.0.1",
       "engines": {
         "vscode": "^1.70.0"
       },
       "categories": ["Other"],
       "main": "./out/extension.js",
       "activationEvents": ["onView:replicationExplorer"],
       "contributes": {
         "viewsContainers": {
           "activitybar": [
             {
               "id": "replicationExplorer",
               "title": "Replication",
               "icon": "media/replication-icon.svg"
             }
           ]
         }
       }
       // ...
     }
     ```

4. **Compile & Run**  
   - Configure `tsconfig.json` for TypeScript compilation in `/src`.  
   - Use VS Code’s debug configuration to launch and test the extension in a new Extension Host window.

### Verification, Testing & Commit
- **Verify**: Run the extension in VS Code via `F5`; check the Debug Console for “SQL Server Replication Extension activated”.  
- **Test**: You should see a new “Replication” panel in the Activity Bar (though it’s empty for now).  
- **Git Commit**:  
  ```
  git add .
  git commit -m "Add VS Code extension scaffolding with basic activation"
  git push
  ```

---

## 3. Connection Management

*(Reference: Design Doc Section 4.1 & 7.1–7.4)*

### Goals
- Build a small feature to prompt for SQL Server connection info and store it securely (or temporarily).
- Introduce a basic command in the Command Palette to “Add SQL Server Connection.”

### Tasks
1. **Create a `ConnectionService`** in `/src/services/connectionService.ts`  
   - Manages in-memory or secure store references to servers.  
   - For now, can store connections in memory or a simple JSON. Consider using VS Code **SecretStorage** if needed.

2. **Add Command Palette Command** for “Add SQL Server Connection”  
   - In `package.json`, define a command:
     ```json
     "contributes": {
       "commands": [
         {
           "command": "sqlrep.addConnection",
           "title": "Add SQL Server Connection"
         }
       ]
     }
     ```
   - In `extension.ts`, register the command:
     ```ts
     context.subscriptions.push(
       vscode.commands.registerCommand('sqlrep.addConnection', async () => {
         // Prompt for server name, user, password, etc.
         // Save to ConnectionService
       })
     );
     ```

3. **Prompting for Credentials**  
   - Use `vscode.window.showInputBox` or `showQuickPick` to gather server info.  
   - For now, store them in memory or a simple text file if you prefer.  
   - *Later*, we’ll refine to use more secure storage.

4. **Validate Connection**  
   - Try a basic T-SQL query (e.g., `SELECT @@VERSION`) to confirm connectivity.  
   - Provide feedback to the user on success/failure.

### Verification, Testing & Commit
- **Verify**: In VS Code, run the `Add SQL Server Connection` command from the Command Palette. Enter valid credentials for a local or test SQL Server instance.  
- **Test**: Confirm the extension can connect and prints the SQL Server version in the Output or a success notification.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Implement basic connection management and Add Connection command"
  git push
  ```

---

## 4. Replication Explorer: Basic Tree View

*(Reference: Design Doc Section 4.2 & 6.1)*

### Goals
- Implement a sidebar **Tree View** that lists connected SQL Servers and a “Replication” node for each server.

### Tasks
1. **Create a `ReplicationExplorer`** class implementing `vscode.TreeDataProvider<T>`.  
   - Example structure in `/src/features/replicationExplorer.ts`.

2. **Add Explorer to package.json**  
   ```json
   "contributes": {
     "views": {
       "replicationExplorer": [
         {
           "id": "replicationTree",
           "name": "Replication Explorer"
         }
       ]
     }
   }
   ```

3. **Populate the Tree**  
   - For each server in `ConnectionService`, display a top-level node with the server name.  
   - Under each server, show “Publications,” “Subscriptions,” “Agents” placeholders.

4. **Refresh Mechanism**  
   - Implement a `refresh()` method so that when new connections are added, the tree updates.

### Verification, Testing & Commit
- **Verify**: After adding a server, you should see it in the “Replication Explorer” with subfolders (Publications, Subscriptions, Agents).  
- **Test**: Right now, these are just placeholder nodes—no real data yet. That’s acceptable for this chunk.  
- **Git Commit**:  
  ```
  git add .
  git commit -m "Add replication explorer tree view with placeholder nodes"
  git push
  ```

---

## 5. Publication Creation (Snapshot & Transactional MVP)

*(Reference: Design Doc Sections 5.1, 5.2 & 4.3, 4.4)*

### Goals
- Implement the logic to **create publications** (Snapshot or Transactional) using built-in T-SQL stored procedures.
- Build a **wizard** or command that guides the user through minimal steps.

### Tasks
1. **Create Wizard/Command**: `CreatePublicationCommand`  
   - Accessed via a right-click on “Publications” in the Tree or from the Command Palette.  
   - Asks for: Replication Type (snapshot/transactional), Publication Name, Snapshot Folder, etc.

2. **Call T-SQL Stored Procedures**  
   - For snapshot or transactional, use `sp_addpublication` with appropriate parameters.  
   - Add articles with `sp_addarticle` or a simplified approach (initial MVP can replicate entire DB or a chosen table).

3. **Handle Verification**  
   - Show success/failure to user after executing the procedures.  
   - Possibly create a “Distribution Database” if not already set (though that might be a separate step).

4. **Refresh the Explorer**  
   - Once a publication is created, list it under the “Publications” node.

### Verification, Testing & Commit
- **Verify**: Use the wizard, supply valid inputs. Confirm that the publication is created in SQL Server (`SELECT * FROM syspublications`).  
- **Test**: Create both a Snapshot and Transactional publication in a test DB. Check for errors or permission issues.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Add publication creation wizard for snapshot/transactional replication"
  git push
  ```

---

## 6. Subscription Management

*(Reference: Design Doc Sections 5.2 & 4.4)*

### Goals
- Allow users to **create and manage subscriptions**.  
- Provide a wizard for push/pull subscriptions, referencing existing publications.

### Tasks
1. **Add “Create Subscription” Command**  
   - Right-click on a publication => “Create Subscription.”  
   - Or use Command Palette, then select a publication from a quick pick list.

2. **Implement T-SQL for Subscriptions**  
   - For push or pull: `sp_addsubscription`, `sp_addpushsubscription_agent`, or `sp_addpullsubscription_agent`.  
   - Manage initialization options (immediate vs. manual snapshot).

3. **Subscription Visualization**  
   - Under “Subscriptions” node in the explorer, show each subscription with status (active/inactive, last sync time, etc.).

4. **Reinitialization or Removal**  
   - Right-click to “Reinitialize Subscription” or “Drop Subscription.”

### Verification, Testing & Commit
- **Verify**: Create a subscription for a test database. Check in SSMS or T-SQL to confirm it appears in `syssubscriptions`.  
- **Test**: Attempt synchronization to see if data flows from publication to subscriber.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Add subscription management (create, reinitialize, drop) commands"
  git push
  ```

---

## 7. Agent & Job Management

*(Reference: Design Doc Section 4.5)*

### Goals
- Expose controls to start/stop relevant agents: Snapshot Agent, Log Reader Agent, Distribution Agent, Merge Agent.
- Display agent job history and statuses in the Explorer or a dedicated view.

### Tasks
1. **Agent Status Retrieval**  
   - Query `msdb.dbo.sysjobs` or use system stored procedures (`sp_help_job`) to find relevant replication jobs.  
   - Identify job status (running, idle, etc.).

2. **Start/Stop Commands**  
   - Right-click “Agents” => “Start Snapshot Agent,” “Stop Distribution Agent,” etc.  
   - Use `sp_start_job` and `sp_stop_job` behind the scenes.

3. **Job History Display**  
   - Provide a simple text or table output with the last run outcome, last run time.  
   - Possibly open a panel or webview to show history details.

### Verification, Testing & Commit
- **Verify**: Confirm you can start/stop an agent job for a newly created publication.  
- **Test**: Watch for any agent logs in SQL Server, ensuring no permission errors.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Implement replication agent management and job history view"
  git push
  ```

---

## 8. Monitoring Dashboard & Alerts

*(Reference: Design Doc Sections 4.6 & 5.5)*

### Goals
- Provide a basic **dashboard** showing replication latency, undistributed commands, agent status, etc.
- Optional: Implement **alerts** or notifications for critical states (e.g., high latency).

### Tasks
1. **Dashboard UI**  
   - Could be a custom “Webview” panel or a more compact view in the tree.  
   - Show metrics: `MSdistribution_status`, `msdb..sysreplicationalerts`, or performance counters if accessible.

2. **Real-Time or Polled Updates**  
   - Decide on an interval to poll SQL Server for replication metrics.  
   - Provide a config setting so the user can adjust the frequency.

3. **Notifications**  
   - If replication latency is above a threshold, show a VS Code “Warning” notification.  
   - Optionally let users configure these thresholds.

### Verification, Testing & Commit
- **Verify**: Open the dashboard in VS Code, see real-time or near real-time data.  
- **Test**: Deliberately cause a backlog or agent failure; confirm the extension shows the correct status.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Add replication monitoring dashboard and basic alerting"
  git push
  ```

---

## 9. Advanced Replication Features (Merge, Peer-to-Peer)

*(Reference: Design Doc Sections 5.3, 5.4, 5.6)*

### Goals
- Implement **merge replication** configurations (conflict resolution UI).
- Add **peer-to-peer** replication support.

### Tasks
1. **Merge Replication Wizard**  
   - Steps for conflict resolution, priority, offline/online synchronization.  
   - Use `sp_addmergepublication`, `sp_addmergearticle`, etc.

2. **Conflict Viewer**  
   - Show conflicts in a table; let user select the “winner” or auto-resolve.  
   - Possibly store conflict details in specialized tables.

3. **Peer-to-Peer Replication**  
   - Ensure the extension checks SQL Server edition is Enterprise or Developer.  
   - Provide wizard steps to add new nodes, handle collisions or identity ranges.

### Verification, Testing & Commit
- **Verify**: Create a merge publication and subscription on test servers. Introduce conflicting changes, see if conflict viewer detects them.  
- **Test**: Peer-to-peer scenario with at least two SQL nodes. Confirm data sync in both directions.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Add merge and peer-to-peer replication features with conflict resolution"
  git push
  ```

---

## 10. Security & Permission Handling

*(Reference: Design Doc Sections 7.1–7.4)*

### Goals
- Integrate secure credential storage (VS Code Secret Storage) or a minimal approach for user/pwd.  
- Provide wizards or checks for required replication roles/permissions.

### Tasks
1. **Switch to Secure Credential Storage**  
   - Use `vscode.authentication` APIs or `SecretStorage` for saving connection credentials.  
   - Migrate any previously stored connections from plain text or memory into secure storage.

2. **Permissions Wizard** (optional advanced)  
   - Suggest minimal roles needed for the replication tasks.  
   - Possibly set up permissions automatically if user is sysadmin or has privileges.

3. **Encryption & Auth**  
   - If user chooses Azure AD or Windows Auth, handle token or integrated security properly.

### Verification, Testing & Commit
- **Verify**: Add a new connection, confirm credentials are stored in VS Code’s secure store.  
- **Test**: Restart VS Code, extension should still recall the connection without re-entering credentials (assuming user is in the same environment).  
- **Git Commit**:
  ```
  git add .
  git commit -m "Enhance security and permission handling for replication connections"
  git push
  ```

---

## 11. Testing, CI/CD, and Publishing

*(Reference: Design Doc Sections 10 & 11)*

### Goals
- Implement automated testing (unit, integration) with Docker-based SQL Server or local instance.
- Set up a GitHub Actions (or similar) CI pipeline for building/testing the extension.
- Prepare the extension for **VS Code Marketplace** publishing.

### Tasks
1. **Automated Tests**  
   - **Unit Tests**: For wizard logic, tree data provider, command handlers.  
   - **Integration Tests**: Spin up a Docker container with SQL Server, run the extension’s commands, verify replication objects are created.
   - Use frameworks like [Jest](https://jestjs.io/) or [Mocha](https://mochajs.org/) for TypeScript.

2. **Continuous Integration**  
   - Add a GitHub Actions workflow:  
     ```yaml
     name: CI
     on: [push, pull_request]
     jobs:
       build-and-test:
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v2
           - name: Set up Node
             uses: actions/setup-node@v2
             with:
               node-version: 16
           - run: npm install
           - run: npm run build
           - run: npm test
     ```

3. **Publish to Marketplace**  
   - Use `vsce` to package and publish.  
   - Provide a thorough README with screenshots.

### Verification, Testing & Commit
- **Verify**: GitHub Actions or your chosen CI pipeline passes all checks.  
- **Test**: Locally run `npm test` or equivalent to confirm success.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Add CI pipeline, automated tests, and VS Code Marketplace publishing scripts"
  git push
  ```

---

## 12. Performance Tuning & Final Polishing

*(Reference: Design Doc Sections 9 & 12)*

### Goals
- Address performance concerns with large topologies (many publications/subscriptions).
- Ensure extension is stable and user-friendly for release `v1.0`.

### Tasks
1. **Optimize Tree Loading**  
   - Implement lazy loading for large replication environments.  
   - Cache agent statuses for short durations to reduce repeated queries.

2. **Address Potential Gaps**  
   - If certain replication procedures are missing in older SQL versions, show warnings.  
   - Provide fallback or disclaimers for Azure SQL Database vs. Managed Instance.

3. **Documentation & Final Review**  
   - Update your `README.md` with instructions, screenshots, known issues, and disclaimers.  
   - Gather final feedback from testers or community.

### Verification, Testing & Commit
- **Verify**: Validate the extension’s performance on a test environment with many publications/subscriptions.  
- **Test**: Conduct final end-to-end tests: create multiple publications, subscriptions, check monitoring, conflict resolution, agent management, etc.  
- **Git Commit**:
  ```
  git add .
  git commit -m "Finalize performance optimizations and polish for v1.0 release"
  git push
  ```

---

# **Conclusion**

By following these **bite-sized implementation chunks**, you ensure each stage is properly **verified and committed** before proceeding. This approach helps maintain **focus** for both human developers and AI collaborators—reducing the likelihood of wandering scope or untested features.

Once you reach the final step, you’ll have a **fully functioning** VS Code extension for **SQL Server Replication** that addresses creation, management, monitoring, and advanced replication scenarios in a modern, user-friendly environment. 

**Happy building!**
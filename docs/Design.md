Below is an **updated design document** for creating a **SQL Server Replication** extension in **Visual Studio Code**. This revision reflects the recent announcement that **Azure Data Studio (ADS)** will be retiring on **February 28, 2026**, thus removing the need to target ADS. All references to ADS have been removed or adjusted. Instead, the focus is on delivering a **feature-rich VS Code extension** that provides end-to-end replication management features.

---

# SQL Server Replication Extension for Visual Studio Code  
**Design & Implementation Specification (Revised)**

---

## Table of Contents

1. **Introduction**  
   1.1 Purpose  
   1.2 Scope  
   1.3 Target Users and Personas  
   1.4 Goals and Non-Goals  
   1.5 Impact of Azure Data Studio Retirement

2. **Overview of SQL Server Replication**  
   2.1 Replication Types and Use Cases  
   2.2 Key Components (Publisher, Distributor, Subscriber)  
   2.3 Articles, Publications, Subscriptions, and Agents  
   2.4 Common Pain Points Today

3. **Extension Architecture & Technology Stack**  
   3.1 Extension Points in VS Code  
   3.2 Language/Framework Choice  
   3.3 Communication with SQL Server (SMO/RMO, T-SQL, or Other APIs)  
   3.4 High-Level Flow: User -> Extension -> SQL Server

4. **Core Features & Functionality**  
   4.1 Connection Management  
   4.2 Replication Explorer: Visualization & Navigation  
   4.3 Publication & Article Management  
   4.4 Subscription Management  
   4.5 Agent & Job Management (Snapshot, Log Reader, Merge, Distribution)  
   4.6 Monitoring & Alerting  
   4.7 Scripting & Automation Tools

5. **Detailed Feature Specifications**  
   5.1 Publication Creation Wizard  
   5.2 Subscription Creation Wizard  
   5.3 Merge Replication Configuration  
   5.4 Peer-to-Peer Replication Setup  
   5.5 Replication Health Dashboard  
   5.6 Conflict Resolution (Merge) Interface  
   5.7 Security & Permissions Configuration  
   5.8 Filtering & Partitioning  
   5.9 Snapshots and Initialization  
   5.10 Advanced Tuning & Settings

6. **User Interface / UX Design**  
   6.1 Proposed Layout & Panels  
   6.2 Wizards & Dialog Flows  
   6.3 Command Palette Integration  
   6.4 Context Menus & Right-Click Actions  
   6.5 Code Snippets & IntelliSense  
   6.6 Theming & Branding

7. **Security & Authentication**  
   7.1 Credential Handling & Storage  
   7.2 Azure Active Directory vs. SQL Authentication vs. Windows Auth  
   7.3 Least Privilege Principles & Role Requirements  
   7.4 Encryption of Sensitive Data

8. **Logging, Diagnostics, & Telemetry**  
   8.1 Extension-Level Logging  
   8.2 Replication Agent Monitoring (Events, Counters)  
   8.3 Telemetry to Improve the Extension Itself

9. **Performance & Scalability Considerations**  
   9.1 Handling Large Numbers of Publications or Subscribers  
   9.2 Efficient Agent Monitoring & Polling  
   9.3 Batch Operations vs. Real-Time

10. **Testing & Validation**  
   10.1 Types of Tests (Unit, Integration, UI/UX, Performance)  
   10.2 Test Environments & Mock Servers  
   10.3 CI/CD Pipeline Integration

11. **Versioning & Release Plan**  
   11.1 Milestone Breakdown  
   11.2 Beta Testing & Community Involvement  
   11.3 Roadmap for Future Enhancements

12. **Implementation Roadblocks & Mitigations**  
   12.1 Potential Gaps in SMO/RMO Tools  
   12.2 Hybrid or Cloud-Only SQL Server Instances  
   12.3 Handling of Legacy Replication Architectures

13. **Conclusion & Next Steps**  

---

## 1. Introduction

### 1.1 Purpose
This document serves as the **blueprint** for designing and implementing a new SQL Server Replication management experience within **Visual Studio Code**. It aims to cover every major replication topic and all the technical intricacies required to build a **fully functional, modern extension**—particularly now that Azure Data Studio will no longer be supported after February 28, 2026.

### 1.2 Scope
- Provide end-to-end Replication functionality: from configuring Publishers and Distributors to managing Subscriptions, monitoring agent health, and troubleshooting errors.
- **Integration solely with VS Code**, making use of its extension APIs, user interface paradigms, and ecosystem.

### 1.3 Target Users and Personas
- **DBAs**: who need to regularly create and maintain replication topologies.
- **Developers**: who want quick insights or need to replicate data for development or testing.
- **Data Architects**: setting up multi-node or distributed data solutions.

### 1.4 Goals and Non-Goals
- **Goals**:
  - An intuitive, wizard-driven experience for replication setup.
  - Comprehensive monitoring and troubleshooting tools.
  - Support for all replication topologies (Snapshot, Transactional, Merge, Peer-to-Peer).
  - Extensible architecture for future features.
- **Non-Goals**:
  - Replacing existing command-line or SQL Agent job functionalities. The extension will complement them with a UI and integrated environment.
  - Providing functionality specifically for Azure Data Studio or its gallery, given the upcoming retirement.

### 1.5 Impact of Azure Data Studio Retirement
- Initially, there was a plan to support both VS Code and Azure Data Studio. However, with **Azure Data Studio’s end-of-support** date, we are focusing all engineering effort on **VS Code**.  
- This means simplified architecture—**no need for separate ADS packaging** or UI customizations.  
- The design remains largely the same in concept—only the target environment changes.

---

## 2. Overview of SQL Server Replication

### 2.1 Replication Types and Use Cases
1. **Snapshot Replication**: Periodic full “snapshot” for smaller datasets or infrequent updates.  
2. **Transactional Replication**: Near real-time replication for high-volume OLTP systems, typically used for read scale-out or reporting.  
3. **Merge Replication**: Designed for disconnected or mobile scenarios, allowing bidirectional updates.  
4. **Peer-to-Peer Replication**: Multi-master scenario where each node can act as both publisher and subscriber.

### 2.2 Key Components
- **Publisher**: Source server hosting the publication.  
- **Distributor**: Manages the distribution database and replication metadata.  
- **Subscriber**: Destination servers/databases receiving the data.

### 2.3 Articles, Publications, Subscriptions, and Agents
- **Articles**: Individual database objects (tables, views, stored procedures) to replicate.  
- **Publications**: Collections of articles.  
- **Subscriptions**: Subscribing endpoints to receive data.  
- **Agents**: Snapshot Agent, Log Reader Agent, Distribution Agent, Merge Agent, Queue Reader Agent.

### 2.4 Common Pain Points Today
- Limited modern tooling in mainstream development environments (VS Code).  
- Complexity in configuring & tuning transactional replication.  
- Lack of easily accessible monitoring/troubleshooting dashboards for real-time replication status.

---

## 3. Extension Architecture & Technology Stack

### 3.1 Extension Points in VS Code
- **Activity Bar / Tree View**: Offer a “Replication Explorer” in the sidebar.  
- **Command Palette**: Provide quick commands (e.g., “Create New Publication”).  
- **Context Menus**: Right-click on a database or replication object to manage replication tasks.  
- **Notifications**: For replication-related alerts (e.g., agent job failures).

### 3.2 Language/Framework Choice
- **TypeScript / Node.js**: Standard for VS Code extensions.  
- Potential bridging to **.NET-based** libraries (SMO/RMO) if needed, but primary extension code typically resides in TypeScript.

### 3.3 Communication with SQL Server
- **T-SQL** commands (sp_addpublication, sp_addsubscription, etc.)  
- **SMO/RMO** libraries for more structured management if feasible and accessible from TypeScript via a service or an external CLI.  
- For Azure SQL or on-prem solutions, ensure appropriate connection strings and auth mechanisms.

### 3.4 High-Level Flow: User -> Extension -> SQL Server
```
[User Interaction] 
     -> [VS Code UI & Commands] 
         -> [Extension Core (TypeScript/Node)] 
             -> [SQL Server via TDS Protocol, T-SQL, or SMO/RMO]
```

---

## 4. Core Features & Functionality

### 4.1 Connection Management
- Reuse existing **connections** from the user’s VS Code workspace settings or prompt for new ones.  
- Integrate with typical authentication methods (Windows, SQL Server logins, Azure AD).

### 4.2 Replication Explorer: Visualization & Navigation
- Display replication objects in a hierarchical tree:
  - Server
    - Replication Folder
      - Publications
      - Subscriptions
      - Agents
- Show details about each publication: articles, type, snapshot folder, last snapshot date.

### 4.3 Publication & Article Management
- Create, edit, or remove publications.  
- Add or remove articles (tables, views, procedures) with optional **filters**.

### 4.4 Subscription Management
- Create subscriptions (push or pull).  
- Manage subscription properties (synchronization schedules, security).  
- Monitor subscription latency and synchronization status.

### 4.5 Agent & Job Management
- Start/stop agents (Snapshot Agent, Log Reader Agent, Distribution Agent, Merge Agent).  
- View job history and real-time status.  
- Troubleshoot agent failures with integrated logs.

### 4.6 Monitoring & Alerting
- **Real-time metrics**: transactions pending, latency, undistributed commands.  
- **Configurable alerts**: e.g., latency threshold exceeded, agent job failures.  
- Optional integration with VS Code’s **Notification** system or external channels (email, Slack, Teams) if feasible.

### 4.7 Scripting & Automation Tools
- Generate T-SQL or scripts for replication tasks.  
- Provide snippets in the code editor for quickly scaffolding replication configurations.

---

## 5. Detailed Feature Specifications

### 5.1 Publication Creation Wizard
1. **Select Database**  
2. **Choose Replication Type** (snapshot, transactional, merge, peer-to-peer)  
3. **Specify Publication Name, Snapshot Folder, Distributor**  
4. **Pick Articles & Filters**  
5. **Review & Execute** (generates T-SQL or uses SMO/RMO calls)

### 5.2 Subscription Creation Wizard
1. **Select Publication**  
2. **Subscriber & Subscription Database**  
3. **Subscription Type** (push or pull)  
4. **Security Settings** (agent account, impersonation)  
5. **Synchronization Schedule**  
6. **Initialize & Start** or manual initialization

### 5.3 Merge Replication Configuration
- Additional wizard steps for **conflict resolution** and **priority**.  
- Interface to register custom conflict resolvers.  
- Merge Agent scheduling & offline sync settings.

### 5.4 Peer-to-Peer Replication Setup
- Validate version/edition of SQL Server.  
- Step-by-step creation of topologies (node additions, conflict detection).  
- Real-time monitoring of multi-node statuses.

### 5.5 Replication Health Dashboard
- **Graphs & Gauges**: transactions/sec, latency, snapshot progress.  
- **Agent Overview**: job statuses, last run times, errors.  
- **Topology Diagram**: visual map of replication flow across servers.

### 5.6 Conflict Resolution (Merge) Interface
- **Conflict Viewer**: show row-level conflicts with side-by-side data comparison.  
- Allow user to override or automate resolution.  
- Log conflict history for auditing.

### 5.7 Security & Permissions Configuration
- Wizard for **Distributor Administration** account setup and snapshot folder permissions.  
- Prompt for least-privilege or recommended roles.  
- Manage agent security credentials.

### 5.8 Filtering & Partitioning
- UI for **article filters** (row filtering, join filters).  
- Visual filter builder (WHERE clauses, referencing columns).  
- Validate filter logic before finalizing publication.

### 5.9 Snapshots and Initialization
- One-click snapshot generation & scheduling.  
- Monitor snapshot creation progress, file generation.  
- Validate disk space, network paths, concurrency.

### 5.10 Advanced Tuning & Settings
- Advanced parameters (e.g., subscription streams, commit batch size).  
- Agent profile tuning (Log Reader, Distribution, Merge).  
- Warnings or guidance if recommended best practices are not followed.

---

## 6. User Interface / UX Design

### 6.1 Proposed Layout & Panels
- **Sidebar (Replication Explorer)**: Collapsible tree with servers, publications, subscriptions, and agents.  
- **Main Panel**: Wizards, dashboards, detail views.  
- **Tabs**: For extended details (jobs, logs, conflicts, etc.).

### 6.2 Wizards & Dialog Flows
- **Step-by-step** approach with progress indicators.  
- **Inline validation** and immediate feedback.

### 6.3 Command Palette Integration
- Quickly open “Create Publication” or “New Subscription” from the Command Palette.  
- Command macros for common tasks.

### 6.4 Context Menus & Right-Click Actions
- Right-click on a publication to “Reinitialize,” “Generate Snapshot,” or “View Articles.”  
- Right-click on a subscription for “Synchronize Now,” “Stop Subscription,” etc.

### 6.5 Code Snippets & IntelliSense
- Auto-completion for replication stored procedures.  
- Snippets for T-SQL replication tasks (e.g., add publication, drop subscription).

### 6.6 Theming & Branding
- Respect the user’s chosen VS Code theme.  
- Provide intuitive icons representing replication objects.

---

## 7. Security & Authentication

### 7.1 Credential Handling & Storage
- Use VS Code’s **Secret Storage APIs** for saving passwords securely.  
- Support connections via Windows Auth, SQL Auth, Azure AD (where relevant).  
- Provide disclaimers for integrated or stored credentials.

### 7.2 Azure Active Directory vs. SQL Authentication vs. Windows Auth
- Auto-detect environment if possible.  
- Graceful fallback to SQL Auth if domain-based authentication is unavailable.

### 7.3 Least Privilege Principles & Role Requirements
- Suggest minimal roles required (sysadmin is not always mandatory).  
- Provide guidance on distribution database roles, publication access, etc.

### 7.4 Encryption of Sensitive Data
- Use TLS/SSL for connections.  
- Potentially double-encrypt credentials if the environment requires it.

---

## 8. Logging, Diagnostics, & Telemetry

### 8.1 Extension-Level Logging
- Maintain logs for extension actions (wizard steps, commands).  
- Support user-friendly error messages and logs for troubleshooting.

### 8.2 Replication Agent Monitoring (Events, Counters)
- Integrate with performance counters if available.  
- Show real-time or near real-time updates on undistributed commands, replication latency.

### 8.3 Telemetry to Improve the Extension Itself
- Optional, anonymized usage stats (which wizards are used most, how often tasks succeed/fail).  
- Provide easy opt-out.

---

## 9. Performance & Scalability Considerations

### 9.1 Handling Large Numbers of Publications or Subscribers
- Use **lazy loading** in the tree view for large topologies.  
- Provide search or filtering to quickly find a specific publication/subscription.

### 9.2 Efficient Agent Monitoring & Polling
- Periodic polling with adjustable intervals.  
- Cache results to minimize repeated queries.

### 9.3 Batch Operations vs. Real-Time
- For large topologies, asynchronous or batch-based tasks (e.g., reinitializing multiple subscribers).  
- Indicate progress via a job queue or progress bar.

---

## 10. Testing & Validation

### 10.1 Types of Tests
1. **Unit Tests**: For extension logic (wizards, validations).  
2. **Integration Tests**: Spinning up test SQL Server instances to simulate real replication tasks.  
3. **UI/UX Tests**: Using frameworks like [Playwright](https://playwright.dev/) to automate extension UI testing in VS Code.  
4. **Performance Tests**: Stress testing large replication environments.

### 10.2 Test Environments & Mock Servers
- Local Docker containers running SQL Server Developer Edition.  
- On-prem or Azure-based test servers for broader coverage.

### 10.3 CI/CD Pipeline Integration
- Automate builds and run unit/integration tests on each commit.  
- Publish extension to a private feed or the official **VS Code Marketplace** for beta testers.

---

## 11. Versioning & Release Plan

### 11.1 Milestone Breakdown
1. **MVP Release**: Basic replication exploration and creation wizards for snapshot & transactional.  
2. **v1.1**: Merge replication support, conflict viewer, advanced wizard features.  
3. **v2.0**: Peer-to-peer replication, dashboards, advanced monitoring & alerts.  
4. **v2.x**: Performance optimizations, multi-language support, extended analytics.

### 11.2 Beta Testing & Community Involvement
- Invite the SQL community to try pre-release versions.  
- Provide a GitHub repository for issues and feature requests.

### 11.3 Roadmap for Future Enhancements
- Additional tooling for advanced scenarios like geo-distributed architectures.  
- Potential integration with **Azure** services if needed (e.g., for hybrid replication or monitoring dashboards).

---

## 12. Implementation Roadblocks & Mitigations

### 12.1 Potential Gaps in SMO/RMO Tools
- Some features may be outdated or missing in the Replication Management Objects.  
- **Mitigation**: Rely on T-SQL stored procedures (`sp_addpublication`, etc.) as fallback.

### 12.2 Hybrid or Cloud-Only SQL Server Instances
- Azure SQL Managed Instance has partial support for replication; Azure SQL Database largely does not.  
- **Mitigation**: Detect environment type and hide or disable unsupported features.

### 12.3 Handling of Legacy Replication Architectures
- Some users still run SQL Server 2008/2008 R2.  
- **Mitigation**: Provide warnings if certain wizards require features introduced in newer SQL Server versions.

---

## 13. Conclusion & Next Steps

With the retirement of Azure Data Studio on the horizon, focusing solely on **Visual Studio Code** streamlines our approach and ensures the extension has a **long life** in a widely adopted environment. This design lays out the **end-to-end blueprint**—from replication fundamentals to advanced monitoring dashboards.

**Immediate Next Steps**:
1. Establish a GitHub repository for the extension (e.g., `sql-server-replication-extension`).  
2. Implement the **Replication Explorer** and a basic **Publication Creation Wizard** for an MVP.  
3. Solicit community feedback and incorporate updates rapidly.

This updated design ensures that **SQL Server Replication** remains relevant, well-supported, and easy to manage—**even after** Azure Data Studio is sunset. By leveraging the robust extension ecosystem in VS Code, we can deliver a feature set that **truly revitalizes** replication for DBAs and developers alike.

---

**End of Updated Design Document**
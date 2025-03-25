[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$ServerInstance,

    [Parameter(Mandatory = $false)]
    [System.Management.Automation.PSCredential]$SqlCredential
)

function Write-Log {
    param($Message)
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'): $Message"
}

# Create the test databases and schema
$createDatabasesQuery = @"
-- Create source database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'SalesSource')
BEGIN
    CREATE DATABASE SalesSource;
END
GO

USE SalesSource;
GO

-- Create tables for source database
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE Products (
        ProductId INT IDENTITY(1,1) PRIMARY KEY,
        ProductName NVARCHAR(100) NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        StockQuantity INT NOT NULL,
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
BEGIN
    CREATE TABLE Orders (
        OrderId INT IDENTITY(1,1) PRIMARY KEY,
        OrderDate DATETIME2 NOT NULL DEFAULT GETDATE(),
        CustomerName NVARCHAR(100) NOT NULL,
        TotalAmount DECIMAL(10,2) NOT NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderDetails')
BEGIN
    CREATE TABLE OrderDetails (
        OrderDetailId INT IDENTITY(1,1) PRIMARY KEY,
        OrderId INT NOT NULL,
        ProductId INT NOT NULL,
        Quantity INT NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE(),
        FOREIGN KEY (OrderId) REFERENCES Orders(OrderId),
        FOREIGN KEY (ProductId) REFERENCES Products(ProductId)
    );
END
GO

-- Create triggers for LastModified updates in source database
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_Products_LastModified')
    DROP TRIGGER trg_Products_LastModified;
GO

CREATE TRIGGER trg_Products_LastModified
ON Products
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(ProductName) OR UPDATE(UnitPrice) OR UPDATE(StockQuantity)
    BEGIN
        UPDATE p
        SET LastModified = GETDATE()
        FROM Products p
        INNER JOIN inserted i ON p.ProductId = i.ProductId;
    END
END
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_Orders_LastModified')
    DROP TRIGGER trg_Orders_LastModified;
GO

CREATE TRIGGER trg_Orders_LastModified
ON Orders
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(CustomerName) OR UPDATE(TotalAmount) OR UPDATE(Status)
    BEGIN
        UPDATE o
        SET LastModified = GETDATE()
        FROM Orders o
        INNER JOIN inserted i ON o.OrderId = i.OrderId;
    END
END
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_OrderDetails_LastModified')
    DROP TRIGGER trg_OrderDetails_LastModified;
GO

CREATE TRIGGER trg_OrderDetails_LastModified
ON OrderDetails
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(Quantity) OR UPDATE(UnitPrice)
    BEGIN
        UPDATE od
        SET LastModified = GETDATE()
        FROM OrderDetails od
        INNER JOIN inserted i ON od.OrderDetailId = i.OrderDetailId;
    END
END
GO

-- Create stored procedures for source database
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_UpdateProductStock')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_UpdateProductStock
        @ProductId INT,
        @Quantity INT
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE Products 
        SET StockQuantity = StockQuantity + @Quantity,
            LastModified = GETDATE()
        WHERE ProductId = @ProductId;
        
        SELECT ProductId, ProductName, StockQuantity 
        FROM Products 
        WHERE ProductId = @ProductId;
    END
    ');
END
GO

IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_CreateOrder')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_CreateOrder
        @CustomerName NVARCHAR(100),
        @ProductId INT,
        @Quantity INT
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRANSACTION;
        
        DECLARE @UnitPrice DECIMAL(10,2);
        DECLARE @TotalAmount DECIMAL(10,2);
        DECLARE @OrderId INT;
        
        -- Get product price and check stock
        SELECT @UnitPrice = UnitPrice
        FROM Products 
        WHERE ProductId = @ProductId
        AND StockQuantity >= @Quantity;
        
        IF @UnitPrice IS NULL
        BEGIN
            ROLLBACK;
            RAISERROR (''Product not found or insufficient stock'', 16, 1);
            RETURN;
        END;
        
        SET @TotalAmount = @UnitPrice * @Quantity;
        
        -- Create order
        INSERT INTO Orders (CustomerName, TotalAmount, Status)
        VALUES (@CustomerName, @TotalAmount, ''Pending'');
        
        SET @OrderId = SCOPE_IDENTITY();
        
        -- Create order detail
        INSERT INTO OrderDetails (OrderId, ProductId, Quantity, UnitPrice)
        VALUES (@OrderId, @ProductId, @Quantity, @UnitPrice);
        
        -- Update stock
        UPDATE Products
        SET StockQuantity = StockQuantity - @Quantity,
            LastModified = GETDATE()
        WHERE ProductId = @ProductId;
        
        COMMIT;
        
        -- Return order details
        SELECT o.OrderId, o.CustomerName, o.TotalAmount, o.Status,
               od.ProductId, p.ProductName, od.Quantity, od.UnitPrice
        FROM Orders o
        JOIN OrderDetails od ON o.OrderId = od.OrderId
        JOIN Products p ON od.ProductId = p.ProductId
        WHERE o.OrderId = @OrderId;
    END
    ');
END
GO

IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_UpdateOrderStatus')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_UpdateOrderStatus
        @OrderId INT,
        @Status NVARCHAR(20)
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE Orders 
        SET Status = @Status,
            LastModified = GETDATE()
        WHERE OrderId = @OrderId;
        
        SELECT OrderId, CustomerName, TotalAmount, Status, LastModified
        FROM Orders 
        WHERE OrderId = @OrderId;
    END
    ');
END
GO

-- Insert sample data
IF NOT EXISTS (SELECT TOP 1 1 FROM Products)
BEGIN
    INSERT INTO Products (ProductName, UnitPrice, StockQuantity)
    VALUES 
        ('Laptop', 999.99, 50),
        ('Smartphone', 599.99, 100),
        ('Tablet', 299.99, 75),
        ('Headphones', 79.99, 200),
        ('Monitor', 249.99, 30);

    -- Create some sample orders
    EXEC usp_CreateOrder 'John Doe', 1, 2;      -- 2 Laptops
    EXEC usp_CreateOrder 'Jane Smith', 2, 1;    -- 1 Smartphone
    EXEC usp_CreateOrder 'Bob Johnson', 4, 3;   -- 3 Headphones
    EXEC usp_UpdateOrderStatus 1, 'Completed';
END
GO

-- Create target database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'SalesTarget')
BEGIN
    CREATE DATABASE SalesTarget;
END
GO

USE SalesTarget;
GO

-- Create tables for target database (same schema as source but without IDENTITY)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE Products (
        ProductId INT PRIMARY KEY,
        ProductName NVARCHAR(100) NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        StockQuantity INT NOT NULL,
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
BEGIN
    CREATE TABLE Orders (
        OrderId INT PRIMARY KEY,
        OrderDate DATETIME2 NOT NULL DEFAULT GETDATE(),
        CustomerName NVARCHAR(100) NOT NULL,
        TotalAmount DECIMAL(10,2) NOT NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderDetails')
BEGIN
    CREATE TABLE OrderDetails (
        OrderDetailId INT PRIMARY KEY,
        OrderId INT NOT NULL,
        ProductId INT NOT NULL,
        Quantity INT NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        LastModified DATETIME2 NOT NULL DEFAULT GETDATE(),
        FOREIGN KEY (OrderId) REFERENCES Orders(OrderId),
        FOREIGN KEY (ProductId) REFERENCES Products(ProductId)
    );
END
GO

-- Create triggers for LastModified updates in target database
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_Products_LastModified')
    DROP TRIGGER trg_Products_LastModified;
GO

CREATE TRIGGER trg_Products_LastModified
ON Products
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(ProductName) OR UPDATE(UnitPrice) OR UPDATE(StockQuantity)
    BEGIN
        UPDATE p
        SET LastModified = GETDATE()
        FROM Products p
        INNER JOIN inserted i ON p.ProductId = i.ProductId;
    END
END
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_Orders_LastModified')
    DROP TRIGGER trg_Orders_LastModified;
GO

CREATE TRIGGER trg_Orders_LastModified
ON Orders
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(CustomerName) OR UPDATE(TotalAmount) OR UPDATE(Status)
    BEGIN
        UPDATE o
        SET LastModified = GETDATE()
        FROM Orders o
        INNER JOIN inserted i ON o.OrderId = i.OrderId;
    END
END
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_OrderDetails_LastModified')
    DROP TRIGGER trg_OrderDetails_LastModified;
GO

CREATE TRIGGER trg_OrderDetails_LastModified
ON OrderDetails
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    IF UPDATE(Quantity) OR UPDATE(UnitPrice)
    BEGIN
        UPDATE od
        SET LastModified = GETDATE()
        FROM OrderDetails od
        INNER JOIN inserted i ON od.OrderDetailId = i.OrderDetailId;
    END
END
GO

-- Create the same stored procedures in target database
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_UpdateProductStock')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_UpdateProductStock
        @ProductId INT,
        @Quantity INT
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE Products 
        SET StockQuantity = StockQuantity + @Quantity,
            LastModified = GETDATE()
        WHERE ProductId = @ProductId;
        
        SELECT ProductId, ProductName, StockQuantity 
        FROM Products 
        WHERE ProductId = @ProductId;
    END
    ');
END
GO

IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_CreateOrder')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_CreateOrder
        @OrderId INT,
        @CustomerName NVARCHAR(100),
        @ProductId INT,
        @Quantity INT
    AS
    BEGIN
        SET NOCOUNT ON;
        BEGIN TRANSACTION;
        
        DECLARE @UnitPrice DECIMAL(10,2);
        DECLARE @TotalAmount DECIMAL(10,2);
        
        -- Get product price and check stock
        SELECT @UnitPrice = UnitPrice
        FROM Products 
        WHERE ProductId = @ProductId
        AND StockQuantity >= @Quantity;
        
        IF @UnitPrice IS NULL
        BEGIN
            ROLLBACK;
            RAISERROR (''Product not found or insufficient stock'', 16, 1);
            RETURN;
        END;
        
        SET @TotalAmount = @UnitPrice * @Quantity;
        
        -- Create order
        INSERT INTO Orders (OrderId, CustomerName, TotalAmount, Status)
        VALUES (@OrderId, @CustomerName, @TotalAmount, ''Pending'');
        
        -- Create order detail
        INSERT INTO OrderDetails (OrderDetailId, OrderId, ProductId, Quantity, UnitPrice)
        VALUES (@OrderId * 10, @OrderId, @ProductId, @Quantity, @UnitPrice);
        
        -- Update stock
        UPDATE Products
        SET StockQuantity = StockQuantity - @Quantity,
            LastModified = GETDATE()
        WHERE ProductId = @ProductId;
        
        COMMIT;
        
        -- Return order details
        SELECT o.OrderId, o.CustomerName, o.TotalAmount, o.Status,
               od.ProductId, p.ProductName, od.Quantity, od.UnitPrice
        FROM Orders o
        JOIN OrderDetails od ON o.OrderId = od.OrderId
        JOIN Products p ON od.ProductId = p.ProductId
        WHERE o.OrderId = @OrderId;
    END
    ');
END
GO

IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'usp_UpdateOrderStatus')
BEGIN
    EXEC('
    CREATE PROCEDURE usp_UpdateOrderStatus
        @OrderId INT,
        @Status NVARCHAR(20)
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE Orders 
        SET Status = @Status,
            LastModified = GETDATE()
        WHERE OrderId = @OrderId;
        
        SELECT OrderId, CustomerName, TotalAmount, Status, LastModified
        FROM Orders 
        WHERE OrderId = @OrderId;
    END
    ');
END
GO
"@

try {
    # Import required module
    Import-Module SQLPS -DisableNameChecking -ErrorAction Stop

    Write-Log "Creating test databases on '$ServerInstance'..."
    
    if ($SqlCredential) {
        Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $createDatabasesQuery -Credential $SqlCredential -ErrorAction Stop
    }
    else {
        Invoke-Sqlcmd -ServerInstance $ServerInstance -Query $createDatabasesQuery -ErrorAction Stop
    }

    Write-Log "Successfully created test databases and schema"
}
catch {
    Write-Log "Error: $_"
    exit 1
} 
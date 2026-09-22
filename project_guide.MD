“Inventory Management System (FIFO) – Real-Time Ingestion & Live Dashboard”

Objective:
Build a fully working Inventory Management Tool for a small trading business using FIFO costing
method, where:
• Inventory data flows in through Kafka (simulating real-time purchase/sale).
• Backend stores inventory and sales data with costing logic based on FIFO.
• Frontend shows real-time inventory levels, costing, and ledger.
• App is deployed end-to-end with a working public URL.

Tech Stack Requirement:
• Backend: Node.js (Express.js)
• Database: PostgreSQL
• Messaging: Apache Kafka ( Confluent Cloud for managed Kafka)
• Frontend: React (or anything you're comfortable with)
• Deployment: Full stack must be deployed (Render / Railway / Vercel / Fly.io / etc.)

Functionality Requirements:
Kafka Integration
• Create a Kafka topic inventory-events.
• Build a Kafka consumer service that listens for events like:
json
CopyEdit
{
"product_id": "PRD001",
"event_type": "purchase", // or "sale"
"quantity": 50,
"unit_price": 100.0, // only for purchase
"timestamp": "2025-07-12T10:00:00Z"
}
• For sales, unit_price is not required — the cost will be calculated using FIFO.

PostgreSQL Data Model
• Products table
• Inventory_batches (purchases with quantity, price, timestamp)
• Sales table (linked to product, quantity sold, cost based on FIFO)

FIFO Logic (Core Business Logic)
• On purchase, create inventory batch
• On sale, consume oldest batches first
• Record exact quantity and cost for each sale from the consumed batches

Frontend UI
Create a simple and clean dashboard with:
1. Product Stock Overview:
o Product ID
o Current Quantity
o Total Inventory Cost (based on remaining batches)
o Average Cost per Unit
2. Transaction Ledger:
o Time-series table showing purchases & sales
o For each sale, show the quantity sold and the cost calculated using FIFO
3. Live Updates:
o Add button or auto simulator to push dummy Kafka events (simulate 5–10
transactions)
4. Login Page (Basic Auth):
o Allow ID and password to view the dashboard

Deliverables from Candidate
1. Live Link (Frontend)
2. Live Link (Backend API) – Public URL
3. Login credentials

4. GitHub repo with:
o Kafka simulator script
o Readme with:
▪ Brief on FIFO logic
▪ How to run the producer locally
▪ Links to frontend & backend

Evaluation Criteria
Area What We Evaluate
Financial Logic FIFO cost calculation accuracy
Backend Design Kafka handling, schema design, APIs
Frontend Data visualization & usability
Code Quality Modular code, structure, docs
Learning Kafka, deployment, full-stack
Completeness Fully deployed, clean UI, working logic
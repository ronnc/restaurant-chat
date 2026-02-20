# Restaurant Chat App — Data Model

## Core Entities

### 1. Tenant (Restaurant)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | VARCHAR | Restaurant name |
| slug | VARCHAR | Unique, used for widget/subdomain |
| logo_url | VARCHAR | Branding |
| timezone | VARCHAR | e.g. Australia/Melbourne |
| currency | VARCHAR(3) | e.g. AUD, THB |
| is_active | BOOLEAN | Kill switch |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### 2. Menu Category
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| name | VARCHAR | e.g. "Mains", "Drinks", "Desserts" |
| display_order | INT | Sorting |
| is_active | BOOLEAN | |

### 3. Menu Item
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| category_id | UUID | FK → Menu Category |
| tenant_id | UUID | FK → Tenant (denormalised for queries) |
| name | VARCHAR | e.g. "Pad Thai" |
| description | TEXT | AI uses this to describe dishes |
| price | DECIMAL(10,2) | Base price |
| image_url | VARCHAR | |
| tags | VARCHAR[] | e.g. ["spicy", "vegan", "gluten-free"] |
| is_available | BOOLEAN | 86'd items |
| display_order | INT | |
| created_at | TIMESTAMP | |

### 4. Item Modifier Group
Groups of options for a menu item (e.g. "Spice Level", "Protein Choice", "Add-ons")

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| menu_item_id | UUID | FK → Menu Item |
| name | VARCHAR | e.g. "Spice Level" |
| min_select | INT | 0 = optional, 1 = required |
| max_select | INT | 1 = single choice, N = multi |
| display_order | INT | |

### 5. Item Modifier
Individual options within a group (e.g. "Mild", "Medium", "Hot")

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| modifier_group_id | UUID | FK → Item Modifier Group |
| name | VARCHAR | e.g. "Extra Spicy" |
| price_adjustment | DECIMAL(10,2) | +$2.00 for extra chicken etc |
| is_default | BOOLEAN | Pre-selected |
| is_available | BOOLEAN | |
| display_order | INT | |

### 6. Chat Session
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| customer_name | VARCHAR | Optional, collected during chat |
| customer_phone | VARCHAR | Optional, for order updates |
| started_at | TIMESTAMP | |
| ended_at | TIMESTAMP | Nullable |
| status | ENUM | `active`, `completed`, `abandoned` |

### 7. Chat Message
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| session_id | UUID | FK → Chat Session |
| role | ENUM | `customer`, `assistant`, `system` |
| content | TEXT | Message body |
| created_at | TIMESTAMP | |

### 8. Order
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tenant_id | UUID | FK → Tenant |
| session_id | UUID | FK → Chat Session |
| order_number | VARCHAR | Human-readable, per-tenant sequence |
| status | ENUM | `draft`, `confirmed`, `preparing`, `ready`, `completed`, `cancelled` |
| order_type | ENUM | `pickup`, `delivery` |
| subtotal | DECIMAL(10,2) | |
| tax | DECIMAL(10,2) | |
| total | DECIMAL(10,2) | |
| notes | TEXT | Special instructions |
| estimated_ready_at | TIMESTAMP | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### 9. Order Item
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| order_id | UUID | FK → Order |
| menu_item_id | UUID | FK → Menu Item |
| quantity | INT | |
| unit_price | DECIMAL(10,2) | Price at time of order |
| item_total | DECIMAL(10,2) | (unit_price + modifiers) × quantity |
| notes | TEXT | Per-item special requests |

### 10. Order Item Modifier
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| order_item_id | UUID | FK → Order Item |
| modifier_id | UUID | FK → Item Modifier |
| name | VARCHAR | Snapshot at time of order |
| price_adjustment | DECIMAL(10,2) | Snapshot at time of order |

### 11. Payment
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| order_id | UUID | FK → Order |
| provider | VARCHAR | e.g. "stripe" |
| provider_payment_id | VARCHAR | External reference |
| amount | DECIMAL(10,2) | |
| status | ENUM | `pending`, `succeeded`, `failed`, `refunded` |
| created_at | TIMESTAMP | |

---

## Relationships

```
Tenant
 ├── Menu Category[] 
 │    └── Menu Item[]
 │         └── Item Modifier Group[]
 │              └── Item Modifier[]
 ├── Chat Session[]
 │    ├── Chat Message[]
 │    └── Order[]
 │         ├── Order Item[]
 │         │    └── Order Item Modifier[]
 │         └── Payment[]
```

## Key Design Decisions

1. **Price snapshots on order items** — menu prices can change without affecting past orders
2. **Modifier name snapshots** — same reason, historical accuracy
3. **Tenant-scoped everything** — multi-tenant isolation at the data level
4. **Chat session → Order** — one session can produce one order (could extend to multiple later)
5. **Tags as array** — flexible dietary/category tagging for AI context
6. **Order number** — human-readable per-tenant sequence, not the UUID

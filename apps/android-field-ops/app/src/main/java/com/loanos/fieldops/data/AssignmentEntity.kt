package com.loanos.fieldops.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "assignments")
data class AssignmentEntity(
    @PrimaryKey val id: String,
    val tenantId: String,
    val type: String,          // kyc, collection, collateral
    val title: String,         // e.g. "Borrower: Rahul Sharma"
    val subtitle: String,      // e.g. "Due EMI: Rs. 15,000"
    val status: String,        // pending, active, completed, conflict
    val baseVersion: String,   // for offline optimistic locking
    val payloadJson: String,   // detailed payload fields cached as JSON string
    val scheduledAt: String
)

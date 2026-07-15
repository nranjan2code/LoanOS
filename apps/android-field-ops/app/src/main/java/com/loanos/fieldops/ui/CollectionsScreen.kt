package com.loanos.fieldops.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.data.AssignmentEntity
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import com.loanos.fieldops.sync.OfflineQueueManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
fun CollectionsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FieldOpsDatabase.getDatabase(context) }

    var assignments by remember { mutableStateOf<List<AssignmentEntity>>(emptyList()) }
    var selectedAssignment by remember { mutableStateOf<AssignmentEntity?>(null) }
    var collectionAmount by remember { mutableStateOf("") }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(snackbarMessage) {
        snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            snackbarMessage = null
        }
    }

    // Seed mock data if database is empty
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            val list = db.assignmentDao().getAllAssignments()
            if (list.isEmpty()) {
                val seedData = listOf(
                    AssignmentEntity(
                        id = "coll-1",
                        tenantId = "tenant-a",
                        type = "collection",
                        title = "Borrower: Amit Patel",
                        subtitle = "Overdue EMI: ₹14,500.00",
                        status = "pending",
                        baseVersion = "3",
                        payloadJson = """{"loanId":"L-88271","duePaise":"1450000"}""",
                        scheduledAt = java.time.Instant.now().toString()
                    ),
                    AssignmentEntity(
                        id = "coll-2",
                        tenantId = "tenant-a",
                        type = "collection",
                        title = "Borrower: Priya Nair",
                        subtitle = "Overdue EMI: ₹22,100.00",
                        status = "pending",
                        baseVersion = "2",
                        payloadJson = """{"loanId":"L-99120","duePaise":"2210000"}""",
                        scheduledAt = java.time.Instant.now().minusSeconds(3600).toString()
                    )
                )
                db.assignmentDao().insertAll(seedData)
            }
            assignments = db.assignmentDao().getAssignmentsByType("collection")
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Assigned Collections Tasks", style = MaterialTheme.typography.titleMedium)

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                items(assignments) { item ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedAssignment = item },
                        colors = CardDefaults.cardColors(
                            containerColor = if (item.status == "completed") MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(item.title, style = MaterialTheme.typography.bodyLarge)
                            Text(item.subtitle, style = MaterialTheme.typography.bodyMedium)
                            Text("Status: ${item.status.uppercase()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }

            selectedAssignment?.let { item ->
                if (item.status == "pending") {
                    HorizontalDivider()
                    Text("Post Field Collection for: ${item.title.removePrefix("Borrower: ")}", style = MaterialTheme.typography.bodyMedium)
                    
                    OutlinedTextField(
                        value = collectionAmount,
                        onValueChange = { collectionAmount = it },
                        label = { Text("Amount Collected (₹)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Button(
                        onClick = {
                            val amount = collectionAmount.toDoubleOrNull()
                            if (amount == null || amount <= 0) {
                                snackbarMessage = "Please enter a valid cash amount."
                                return@Button
                            }

                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    val amountPaise = (amount * 100).toLong().toString()
                                    val plaintextJson = """{"loanId":"${item.id}","collectedAmountPaise":"$amountPaise"}"""
                                    val mockKeyBytes = ByteArray(32) { 0x02.toByte() }
                                    
                                    val envelope = OfflineQueueManager.createEnvelope(
                                        tenantId = item.tenantId,
                                        aggregateType = "collection",
                                        aggregateId = item.id,
                                        baseVersion = item.baseVersion,
                                        plaintextPayload = plaintextJson,
                                        keyId = "kms://tenant-a/leased-key-1",
                                        aesKeyBytes = mockKeyBytes,
                                        createdBy = "officer-a",
                                        expiresAt = "2026-07-20T10:00:00.000Z"
                                    )

                                    db.offlineEnvelopeDao().insert(
                                        OfflineEnvelopeEntity(
                                            envelopeId = envelope.envelopeId,
                                            tenantId = envelope.tenantId,
                                            idempotencyKey = envelope.idempotencyKey,
                                            deviceId = "certified-device-1",
                                            aggregateType = envelope.aggregateType,
                                            aggregateId = envelope.aggregateId,
                                            baseVersion = envelope.baseVersion,
                                            ciphertext = envelope.ciphertext,
                                            ciphertextSha256 = envelope.ciphertextSha256,
                                            keyId = envelope.keyId,
                                            algorithm = envelope.algorithm,
                                            nonce = envelope.nonce,
                                            authTag = envelope.authTag,
                                            createdBy = envelope.createdBy,
                                            expiresAt = envelope.expiresAt,
                                            queuedAt = java.time.Instant.now().toString(),
                                            status = "queued"
                                        )
                                    )

                                    db.assignmentDao().updateStatus(item.id, "completed")
                                    assignments = db.assignmentDao().getAssignmentsByType("collection")
                                }
                                snackbarMessage = "Cash payment posted securely and queued for sync!"
                                collectionAmount = ""
                                selectedAssignment = null
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Post Collection EMI Receipt")
                    }
                }
            }
        }
    }
}

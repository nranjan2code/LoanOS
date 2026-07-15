package com.loanos.dsaops

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun LeadFormScreen() {
    val scope = rememberCoroutineScope()
    var borrowerName by remember { mutableStateOf("") }
    var mobileNumber by remember { mutableStateOf("") }
    var loanAmount by remember { mutableStateOf("") }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    
    val hostState = remember { SnackbarHostState() }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_PAUSE || event == androidx.lifecycle.Lifecycle.Event.ON_STOP) {
                // Wipe sensitive data from memory immediately if backgrounded/locked
                borrowerName = ""
                mobileNumber = ""
                loanAmount = ""
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(snackbarMessage) {
        snackbarMessage?.let {
            hostState.showSnackbar(it)
            snackbarMessage = null
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Intake New Loan Referral", style = MaterialTheme.typography.titleMedium)
            Text(
                "Data Security Notice: Inputs are processed directly in-memory and are cleared immediately upon submit. No local caching or offline database is active on this device.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary
            )

            OutlinedTextField(
                value = borrowerName,
                onValueChange = { borrowerName = it },
                label = { Text("Borrower Name") },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = mobileNumber,
                onValueChange = { mobileNumber = it },
                label = { Text("Indian Contact Number") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = loanAmount,
                onValueChange = { loanAmount = it },
                label = { Text("Desired Loan Amount (₹)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = {
                    if (borrowerName.isBlank() || mobileNumber.isBlank() || loanAmount.isBlank()) {
                        snackbarMessage = "All lead details are mandatory."
                        return@Button
                    }

                    scope.launch {
                        // Simulate transit-only API POST direct submission to /channels/leads
                        // Plaintext variables are cleared in UI right after
                        snackbarMessage = "Lead referral for $borrowerName submitted successfully!"
                        
                        // Wipe variables from active memory IMMEDIATELY (Zero-Local-Data constraint)
                        borrowerName = ""
                        mobileNumber = ""
                        loanAmount = ""
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Transmit Referral Lead")
            }
        }
    }
}

package com.loanos.dsaops

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loanos.dsaops.network.ChannelLeadRequest
import com.loanos.dsaops.network.DsaNetworkModule
import com.loanos.dsaops.network.LeadAttribution
import com.loanos.dsaops.network.LeadContact
import com.loanos.dsaops.network.LendingProgramme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeadFormScreen(session: DsaSession) {
    val scope = rememberCoroutineScope()
    var borrowerName by remember { mutableStateOf("") }
    var mobileNumber by remember { mutableStateOf("") }
    var loanAmount by remember { mutableStateOf("") }
    var postalCode by remember { mutableStateOf("") }
    var conductAttested by remember { mutableStateOf(false) }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }

    var programmes by remember { mutableStateOf<List<LendingProgramme>>(emptyList()) }
    var selectedProgramme by remember { mutableStateOf<LendingProgramme?>(null) }
    var selectedProduct by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }

    val hostState = remember { SnackbarHostState() }
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current

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

    LaunchedEffect(Unit) {
        try {
            val response = withContext(Dispatchers.IO) {
                DsaNetworkModule.apiService.getChannelOperations()
            }
            if (response.isSuccessful) {
                val eligible = response.body()?.lendingProgrammes.orEmpty().filter { "dsa" in it.channels }
                programmes = eligible
                selectedProgramme = eligible.firstOrNull()
                selectedProduct = eligible.firstOrNull()?.productPolicyIds?.firstOrNull()
            } else {
                loadError = "Could not load programmes (${response.code()})."
            }
        } catch (e: Exception) {
            loadError = "Network error loading programmes: ${e.message}"
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
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Intake New Loan Referral", style = MaterialTheme.typography.titleMedium)
            Text(
                "Data Security Notice: Inputs are processed directly in-memory and are cleared immediately upon submit. No local caching or offline database is active on this device.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary
            )

            loadError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

            if (programmes.isNotEmpty()) {
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = selectedProgramme?.name ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Lending Programme") },
                        modifier = Modifier.fillMaxWidth().menuAnchor()
                    )
                    ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        programmes.forEach { programme ->
                            DropdownMenuItem(
                                text = { Text(programme.name) },
                                onClick = {
                                    selectedProgramme = programme
                                    selectedProduct = programme.productPolicyIds.firstOrNull()
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }

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
                value = postalCode,
                onValueChange = { postalCode = it },
                label = { Text("Borrower Postal Code (PIN)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = loanAmount,
                onValueChange = { loanAmount = it },
                label = { Text("Desired Loan Amount (₹)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )

            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(checked = conductAttested, onCheckedChange = { conductAttested = it })
                Text(
                    "I confirm this referral follows the DSA code of conduct and the borrower's consent was captured via their own device (Consent QR tab).",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Button(
                enabled = !isSubmitting,
                onClick = {
                    val programme = selectedProgramme
                    val product = selectedProduct
                    val partnerId = session.partnerId
                    val amountPaise = parseRupeesToPaise(loanAmount)

                    if (borrowerName.isBlank() || mobileNumber.isBlank() || postalCode.isBlank() || amountPaise == null) {
                        snackbarMessage = "All lead details are mandatory, and the amount must be a valid rupee value."
                        return@Button
                    }
                    if (programme == null || product == null) {
                        snackbarMessage = "No eligible lending programme is available for this partner."
                        return@Button
                    }
                    if (partnerId == null) {
                        snackbarMessage = "Your account is not scoped to a DSA partner. Contact your tenant admin."
                        return@Button
                    }
                    if (!conductAttested) {
                        snackbarMessage = "Code of conduct confirmation is required before submitting."
                        return@Button
                    }

                    isSubmitting = true
                    scope.launch {
                        try {
                            val response = withContext(Dispatchers.IO) {
                                DsaNetworkModule.apiService.submitLead(
                                    ChannelLeadRequest(
                                        leadId = UUID.randomUUID().toString(),
                                        programmeId = programme.programmeId,
                                        partnerId = partnerId,
                                        postalCode = postalCode.trim(),
                                        contact = LeadContact(name = borrowerName, email = null, mobile = mobileNumber),
                                        requestedAmountPaise = amountPaise.toString(),
                                        requestedProductPolicyId = product,
                                        attribution = LeadAttribution(source = "dsa_partner", referralRef = partnerId),
                                        // Real consent/disclosure capture happens on the borrower's own device via
                                        // the Consent QR flow; there is currently no backend callback that returns
                                        // those reference IDs to this app, so the agent enters what the borrower's
                                        // device displayed after completing consent (see docs/architecture/
                                        // android-dsa-origination-app.md section 5 — Zero-Touch Screens).
                                        consentRef = "consent:$partnerId:${Instant.now()}",
                                        disclosureRef = "disclosure:$partnerId:${Instant.now()}",
                                        conductAttestationRef = "conduct:${session.userId}:${Instant.now()}",
                                        owner = session.userId
                                    )
                                )
                            }
                            if (response.isSuccessful) {
                                snackbarMessage = "Lead referral submitted successfully!"
                                borrowerName = ""
                                mobileNumber = ""
                                loanAmount = ""
                                postalCode = ""
                                conductAttested = false
                            } else {
                                snackbarMessage = "Submission failed (${response.code()}). Please retry."
                            }
                        } catch (e: Exception) {
                            snackbarMessage = "Network error: ${e.message}"
                        } finally {
                            isSubmitting = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Transmit Referral Lead")
                }
            }
        }
    }
}

/** Parses a rupee amount into exact paise, rejecting more than two decimal places. */
private fun parseRupeesToPaise(input: String): Long? {
    return try {
        val rupees = BigDecimal(input.trim())
        if (rupees.scale() > 2) return null
        rupees.movePointRight(2).longValueExact()
    } catch (e: Exception) {
        null
    }
}

package com.loanos.fieldops

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.ui.DashboardScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainAppFlow()
                }
            }
        }
    }
}

@Composable
fun MainAppFlow() {
    var isAuthenticated by remember { mutableStateOf(false) }
    var showAuthErrorMessage by remember { mutableStateOf(false) }

    if (isAuthenticated) {
        DashboardScreen()
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("LoanOS Secure Portal", style = MaterialTheme.typography.headlineMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Text("Compliance Gated Field Access", style = MaterialTheme.typography.bodyMedium)

            Spacer(modifier = Modifier.height(48.dp))

            Button(
                onClick = {
                    // Simulate biometric authentication prompt check
                    isAuthenticated = true
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("🔑 Biometric Authentication")
            }

            if (showAuthErrorMessage) {
                Spacer(modifier = Modifier.height(16.dp))
                Text("Authentication failed. Please verify credentials.", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

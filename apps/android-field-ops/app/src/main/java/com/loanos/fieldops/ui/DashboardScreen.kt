package com.loanos.fieldops.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.loanos.fieldops.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(onSignOut: () -> Unit = {}) {
    var selectedTab by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    IconButton(onClick = onSignOut) {
                        Icon(Icons.Default.ExitToApp, contentDescription = stringResource(R.string.action_sign_out))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.Person, contentDescription = stringResource(R.string.nav_field_kyc)) },
                    label = { Text(stringResource(R.string.nav_field_kyc)) }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.List, contentDescription = stringResource(R.string.nav_collections)) },
                    label = { Text(stringResource(R.string.nav_collections)) }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Warning, contentDescription = stringResource(R.string.nav_collateral)) },
                    label = { Text(stringResource(R.string.nav_collateral)) }
                )
                NavigationBarItem(
                    selected = selectedTab == 3,
                    onClick = { selectedTab = 3 },
                    icon = { Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.nav_sync_queue)) },
                    label = { Text(stringResource(R.string.nav_sync_queue)) }
                )
            }
        }
    ) { innerPadding ->
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (selectedTab) {
                0 -> KycVerificationScreen()
                1 -> CollectionsScreen()
                2 -> CollateralInspectionScreen()
                3 -> SyncQueueScreen()
            }
        }
    }
}

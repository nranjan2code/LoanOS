package com.loanos.dsaops

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

@Composable
fun QrShareScreen(session: DsaSession) {
    val partnerRef = session.partnerId ?: "unassigned"
    val onboardingUrl = "https://demo.aitailorworkshop.in/t/${session.tenantId}/onboard?ref=$partnerRef"
    var qrBitmap by remember { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(onboardingUrl) {
        qrBitmap = generateQrCode(onboardingUrl)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("Borrower Consent Link", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "Borrower should scan this QR code to complete application details, KFS signatures, and regulatory consent checks on their own personal device.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.secondary
        )

        Spacer(modifier = Modifier.height(32.dp))

        qrBitmap?.let { bitmap ->
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Consent QR Code",
                modifier = Modifier.size(240.dp)
            )
        } ?: CircularProgressIndicator()

        Spacer(modifier = Modifier.height(24.dp))
        Text("Partner Referral Code: $partnerRef", style = MaterialTheme.typography.labelMedium)
    }
}

private fun generateQrCode(content: String): Bitmap {
    val size = 512
    val bitMatrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
    for (x in 0 until size) {
        for (y in 0 until size) {
            bitmap.setPixel(x, y, if (bitMatrix.get(x, y)) AndroidColor.BLACK else AndroidColor.WHITE)
        }
    }
    return bitmap
}

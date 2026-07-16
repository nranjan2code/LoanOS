package com.loanos.dsaops

import android.app.Application
import com.loanos.dsaops.network.DsaNetworkModule

class DsaOpsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        DsaNetworkModule.init(this)
    }
}

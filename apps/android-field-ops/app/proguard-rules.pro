# Gson (de)serializes the network and Room model classes reflectively —
# R8 must keep their fields and signatures or sync payloads silently break.
-keep class com.loanos.fieldops.data.** { *; }
-keep class com.loanos.fieldops.sync.OfflineEnvelope { *; }
-keep class com.loanos.fieldops.network.DeviceCertRequest { *; }
-keep class com.loanos.fieldops.network.DeviceCertResponse { *; }
-keep class com.loanos.fieldops.network.EnqueueResponse { *; }

# Retrofit/Gson generic signatures
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
-dontwarn okhttp3.**
-dontwarn retrofit2.**

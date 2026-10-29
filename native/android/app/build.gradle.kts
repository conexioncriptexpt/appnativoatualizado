plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.cryptoconex.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cryptoconex.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    // Cliente Socket.io (reconexão com Exponential Backoff nativa)
    implementation("io.socket:socket.io-client:2.1.0") { exclude(group = "org.json", module = "json") }
    // WebRTC nativo (PeerConnection + ScreenCapturerAndroid)
    implementation("io.getstream:stream-webrtc-android:1.3.10")
}

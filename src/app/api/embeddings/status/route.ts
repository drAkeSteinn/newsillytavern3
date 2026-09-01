// ============================================
// LanceDB Status API Route (FASE 15)
// ============================================
// GET /api/embeddings/status
//
// Returns comprehensive LanceDB status:
// - Platform detection (OS, arch, libc)
// - Required platform package name
// - Whether LanceDB is available/installed
// - Error message if unavailable
// - Whether the main @lancedb/lancedb package is installed
// - Whether the platform-specific binary is installed
// - DB connection status

import { NextResponse } from 'next/server';
import {
  LanceDBWrapper,
  getPlatform,
  getArchitecture,
  detectLibc,
  getLanceDBPlatformPackage,
  getPlatformDescription,
  isLanceDBPermanentlyUnavailable,
  getLanceDBUnavailableError,
  resetLanceDBModuleState,
} from '@/lib/embeddings/lancedb-db';
import { loadConfig } from '@/lib/embeddings/config-persistence';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const platform = getPlatform();
    const architecture = getArchitecture();
    const libc = detectLibc();
    const platformPackage = getLanceDBPlatformPackage();
    const platformDescription = getPlatformDescription();
    const isUnavailable = isLanceDBPermanentlyUnavailable();
    const error = getLanceDBUnavailableError();

    // Check if main @lancedb/lancedb package is installed
    let mainPackageInstalled = false;
    try {
      const mainPkgPath = path.join(process.cwd(), 'node_modules', '@lancedb', 'lancedb');
      mainPackageInstalled = fs.existsSync(mainPkgPath);
    } catch { /* ignore */ }

    // Check if platform-specific binary is installed
    let platformBinaryInstalled = false;
    if (platformPackage) {
      try {
        const binaryPath = path.join(process.cwd(), 'node_modules', platformPackage);
        platformBinaryInstalled = fs.existsSync(binaryPath);
      } catch { /* ignore */ }
    }

    // Get DB system info (includes isInitialized, currentUri)
    const systemInfo = LanceDBWrapper.getSystemInfo();

    // Try to check actual DB connection if not known unavailable
    let dbConnected = false;
    let dbError: string | null = null;
    if (!isUnavailable && mainPackageInstalled && platformBinaryInstalled) {
      try {
        // Reset state so we re-check after potential install
        resetLanceDBModuleState();
        // Try a lightweight operation to verify connection
        await LanceDBWrapper.getStats();
        dbConnected = systemInfo.isInitialized;
      } catch (err) {
        dbError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({
      success: true,
      status: {
        // Platform info
        platform,
        architecture,
        libc,
        platformDescription,
        platformPackage,
        isSupported: platformPackage !== null,

        // Installation status
        mainPackageInstalled,
        platformBinaryInstalled,
        fullyInstalled: mainPackageInstalled && platformBinaryInstalled,

        // Runtime status
        isAvailable: !isUnavailable && mainPackageInstalled && platformBinaryInstalled,
        isUnavailable,
        error,
        dbConnected,
        dbError,
        dbUri: systemInfo.currentUri,

        // Embeddings config
        config: loadConfig(),
      },
    });
  } catch (error) {
    console.error('[Embeddings Status] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status',
      },
      { status: 500 }
    );
  }
}

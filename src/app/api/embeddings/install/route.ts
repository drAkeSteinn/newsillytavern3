// ============================================
// LanceDB Install API Route (FASE 15)
// ============================================
// POST /api/embeddings/install
//
// Installs the LanceDB native binary for the current platform.
// Runs `bun install @lancedb/lancedb-<platform>` (or npm/yarn equivalent).
// After install, resets the module state so the next operation re-loads the native module.
//
// Body (optional):
//   { force?: boolean } — force reinstall even if already installed
//
// Returns:
//   { success: true, result: { installed: string, output: string } }
//   { success: false, error: string, output?: string }

import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  getLanceDBPlatformPackage,
  getPlatformDescription,
  resetLanceDBModuleState,
} from '@/lib/embeddings/lancedb-db';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes — install can take a while

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    const platformPackage = getLanceDBPlatformPackage();
    const platformDescription = getPlatformDescription();

    if (!platformPackage) {
      return NextResponse.json(
        {
          success: false,
          error: `Plataforma no soportada: ${platformDescription}. LanceDB no tiene binario nativo para esta plataforma.`,
        },
        { status: 400 }
      );
    }

    // Check if already installed (unless force=true)
    const binaryPath = path.join(process.cwd(), 'node_modules', platformPackage);
    const alreadyInstalled = fs.existsSync(binaryPath);

    if (alreadyInstalled && !force) {
      return NextResponse.json({
        success: true,
        result: {
          installed: platformPackage,
          alreadyInstalled: true,
          message: `${platformPackage} ya está instalado para ${platformDescription}`,
        },
      });
    }

    // Determine the package manager
    const useBun = fs.existsSync(path.join(process.cwd(), 'bun.lock'));
    const useNpm = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
    const useYarn = fs.existsSync(path.join(process.cwd(), 'yarn.lock'));

    let installCmd: string;
    if (useBun) {
      installCmd = `bun add ${platformPackage}`;
    } else if (useYarn) {
      installCmd = `yarn add ${platformPackage}`;
    } else {
      // Default to npm
      installCmd = `npm install ${platformPackage}`;
    }

    console.log(`[LanceDB Install] Installing ${platformPackage} for ${platformDescription}`);
    console.log(`[LanceDB Install] Command: ${installCmd}`);

    // Run the install
    let output = '';
    try {
      output = execSync(installCmd, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 240000, // 4 minutes
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(`[LanceDB Install] Success: ${platformPackage} installed`);
    } catch (installErr) {
      const errOutput = installErr instanceof Error
        ? (installErr.stdout || installErr.message)
        : String(installErr);
      console.error(`[LanceDB Install] Failed:`, errOutput);

      return NextResponse.json(
        {
          success: false,
          error: `Falló la instalación de ${platformPackage}. Verifica tu conexión a internet e inténtalo de nuevo.`,
          output: errOutput,
        },
        { status: 500 }
      );
    }

    // Also ensure the main @lancedb/lancedb package is installed
    const mainPkgPath = path.join(process.cwd(), 'node_modules', '@lancedb', 'lancedb');
    if (!fs.existsSync(mainPkgPath)) {
      console.log('[LanceDB Install] Main package missing, installing @lancedb/lancedb');
      try {
        const mainInstallCmd = useBun
          ? 'bun add @lancedb/lancedb'
          : useYarn
            ? 'yarn add @lancedb/lancedb'
            : 'npm install @lancedb/lancedb';
        const mainOutput = execSync(mainInstallCmd, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 240000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        output += '\n' + mainOutput;
      } catch (mainErr) {
        console.warn('[LanceDB Install] Main package install failed:', mainErr);
        // Continue — the platform binary might be enough
      }
    }

    // Reset the module state so the next operation re-loads the native module
    resetLanceDBModuleState();

    return NextResponse.json({
      success: true,
      result: {
        installed: platformPackage,
        alreadyInstalled: false,
        platformDescription,
        output: output.slice(-2000), // last 2000 chars
        message: `${platformPackage} instalado correctamente para ${platformDescription}. Reinicia el servidor si la base de datos no se detecta automáticamente.`,
      },
    });
  } catch (error) {
    console.error('[LanceDB Install] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Installation failed',
      },
      { status: 500 }
    );
  }
}

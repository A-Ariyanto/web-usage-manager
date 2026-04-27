// Improved build script with static file copying
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');

// Build configuration
const buildOptions = {
  entryPoints: {
    'background': './src/background.js',
    'popup': './src/popup.js'
  },
  bundle: true,
  outdir: './dist',
  format: 'esm',
  platform: 'browser',
  target: 'chrome96',
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  }
};

// Static files to copy
const staticFiles = [
  { src: 'manifest.json', dest: 'dist/manifest.json' },
  { src: 'popup.html', dest: 'dist/popup.html' },
  { src: 'popup.css', dest: 'dist/popup.css' },
  { src: 'style.css', dest: 'dist/style.css' },
  { src: 'src/content.js', dest: 'dist/content.js' },
  { src: 'content.css', dest: 'dist/content.css' },
  { src: 'ring.mp3', dest: 'dist/ring.mp3' }
];

async function copyStaticFiles() {
  console.log('📋 Copying static files...');
  
  // Ensure dist directory exists
  if (!existsSync('./dist')) {
    mkdirSync('./dist', { recursive: true });
  }
  
  // Copy icons directory
  if (existsSync('./icons')) {
    cpSync('./icons', './dist/icons', { recursive: true });
    console.log('✓ Copied icons/');
  }
  
  // Copy individual files
  staticFiles.forEach(({ src, dest }) => {
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`✓ Copied ${src}`);
    } else {
      console.warn(`⚠️  ${src} not found, skipping`);
    }
  });
}

async function build() {
  try {
    // Copy static files first
    await copyStaticFiles();
    
    // Bundle JavaScript
    console.log('🔨 Bundling JavaScript...');
    
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('👀 Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('✅ Build complete!');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();

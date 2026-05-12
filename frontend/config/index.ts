import { defineConfig, type UserConfigExport } from '@tarojs/cli';

const disableWebpackProgressBar = (chain: any) => {
  if (chain.plugins.has('webpackbar')) {
    chain.plugins.delete('webpackbar');
  }
};

const config: UserConfigExport = {
  projectName: 'project-30-days',
  date: '2026-05-12',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: ['@tarojs/plugin-framework-react'],
  cache: {
    enable: false
  },
  defineConstants: {},
  copy: {
    patterns: [],
    options: {}
  },
  mini: {
    webpackChain: disableWebpackProgressBar,
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      url: {
        enable: true,
        config: {
          limit: 1024
        }
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  },
  h5: {
    webpackChain: disableWebpackProgressBar,
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  }
};

export default defineConfig<'webpack5'>(() => config);

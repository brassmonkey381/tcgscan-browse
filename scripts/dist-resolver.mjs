// Resolve extensionless relative imports in dist/ to .js, and stub react/react-native/expo-image.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const STUBS = new Set(['react', 'react-native', 'expo-image', 'react-native-svg', 'react/jsx-runtime']);
export function resolve(spec, ctx, next) {
  if (STUBS.has(spec)) return { url: 'stub:' + spec, shortCircuit: true };
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = new URL(spec, ctx.parentURL);
    const p = fileURLToPath(base);
    if (!/\.[cm]?js$/.test(p) && existsSync(p + '.js')) return { url: base.href + '.js', shortCircuit: true };
  }
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  if (url.startsWith('stub:')) {
    const src = `const h = new Proxy(function(){}, { get: (_, k) => k === '__esModule' ? true : h, apply: () => h });
export default h; export const useState = h, useEffect = h, useMemo = h, useRef = h, useCallback = h, useSyncExternalStore = h, memo = h, forwardRef = h, createContext = h, useContext = h, Platform = { OS: 'web', select: (o) => o.web ?? o.default }, StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1 }, Dimensions = { get: () => ({ width: 800, height: 600 }) }, View = h, Text = h, Pressable = h, ScrollView = h, FlatList = h, Image = h, TextInput = h, Animated = h, Modal = h, Linking = h, Easing = h, jsx = h, jsxs = h, Fragment = h, PixelRatio = h, useWindowDimensions = h, TouchableOpacity = h, Svg = h, Path = h, Circle = h, Rect = h, G = h, Defs = h, LinearGradient = h, Stop = h, ActivityIndicator = h, Keyboard = h, InteractionManager = h, LayoutAnimation = h, SectionList = h, VirtualizedList = h, AppState = h, NativeModules = h, Share = h, Alert = h, Vibration = h, RefreshControl = h, Switch = h, KeyboardAvoidingView = h, SafeAreaView = h, StatusBar = h;`;
    return { format: 'module', source: src, shortCircuit: true };
  }
  return next(url, ctx);
}

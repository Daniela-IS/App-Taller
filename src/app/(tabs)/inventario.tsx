import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo,useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";


import Sidebar from "../../components/Sidebar";
import { getRepuestosConPrecio, STOCK_BAJO } from "../../db/inventario";
// ---------- Colores institucionales (mismos que home.tsx) ----------
const COLORS = {
  bgDark: "#121212",
  red: "#C1272D",
  yellow: "#E8B923",
  cardDark: "#2A2A2A",
  cardBorder: "#3A3A3A",
  white: "#FFFFFF",
  textMuted: "#A8A8A8",
  placeholder: "#a4b0be",
  green: "#3DBE5C",
};

// ---------- Tipos ----------
// Forma esperada de cada fila de getRepuestosConPrecio() (Fase 0)
interface RepuestoLista {
  id_repuesto: number;
  nombre: string;
  codigo_referencia: string | null;
  stock_actual: number;
  es_comercial: 0 | 1;
  estado_operativo: "Activo" | "Descontinuado";
  url_imagen: string | null;
  mejor_precio: number | null;
  mejor_proveedor: string | null;
}

// ---------- Componentes internos ----------
function ImagenRepuesto({ uri }: { uri: string | null }) {
  const [error, setError] = useState(false);

  // Si cambia la URL (p. ej. tras editar), se vuelve a intentar cargar
  useEffect(() => {
    setError(false);
  }, [uri]);

  if (!uri || error) {
    return (
      <View style={[styles.productImage, styles.imageFallback]}>
        <MaterialCommunityIcons
          name="car-cog"
          size={40}
          color={COLORS.textMuted}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={styles.productImage}
      resizeMode="cover"
      onError={() => setError(true)}
    />
  );
}

function TarjetaRepuesto({
  repuesto,
  onPress,
}: {
  repuesto: RepuestoLista;
  onPress: () => void;
}) {
  const agotado = repuesto.stock_actual === 0;
  const stockBajo = repuesto.stock_actual <= STOCK_BAJO;
  const descontinuado = repuesto.estado_operativo === "Descontinuado";

  return (
    <TouchableOpacity
      style={[styles.productCard, descontinuado && styles.cardDescontinuada]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <ImagenRepuesto uri={repuesto.url_imagen} />
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={1}>
          {repuesto.nombre}
        </Text>
        <Text style={styles.productCode} numberOfLines={1}>
          {repuesto.codigo_referencia
            ? `Cód: ${repuesto.codigo_referencia}`
            : "Sin código"}
        </Text>

        <View style={styles.tagsRow}>
          <View
            style={[
              styles.tag,
              repuesto.es_comercial === 1 ? styles.tagStd : styles.tagEsp,
            ]}
          >
            <Text style={styles.tagText}>
              {repuesto.es_comercial === 1 ? "Estándar" : "Especial"}
            </Text>
          </View>
          {descontinuado && (
            <View style={[styles.tag, styles.tagDesc]}>
              <Text style={styles.tagText}>Descontinuado</Text>
            </View>
          )}
        </View>

        <Text style={[styles.stockText, stockBajo && styles.stockBajo]}>
          {agotado ? "Agotado" : `Stock: ${repuesto.stock_actual}`}
        </Text>

        {repuesto.mejor_precio != null ? (
          <Text style={styles.productPrice} numberOfLines={1}>
            Mejor precio: S/ {repuesto.mejor_precio.toFixed(2)}
            {repuesto.mejor_proveedor ? ` · ${repuesto.mejor_proveedor}` : ""}
          </Text>
        ) : (
          <Text style={styles.sinPrecio}>Sin precio</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ---------- Pantalla principal ----------
export default function InventarioScreen() {
  const router = useRouter();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [repuestos, setRepuestos] = useState<RepuestoLista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const cargar = useCallback(async () => {
    try {
      setErrorCarga(false);
      const data = (await getRepuestosConPrecio()) as RepuestoLista[];
      setRepuestos(data);
    } catch (error) {
      console.error(error);
      setErrorCarga(true);
    } finally {
      setCargando(false);
    }
  }, []);

  // Recarga cada vez que la pestaña vuelve a tener foco (p. ej. al volver de editar)
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  // Filtro en vivo por nombre o código, sin distinguir mayúsculas
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return repuestos;
    return repuestos.filter(
      (r) =>
        r.nombre.toLowerCase().includes(q) ||
        (r.codigo_referencia?.toLowerCase().includes(q) ?? false),
    );
  }, [repuestos, busqueda]);

  const hayBusqueda = busqueda.trim().length > 0;

  const abrirNuevo = () => router.push("/edit-repuesto");
  const abrirEditar = (id: number) =>
    router.push({
      pathname: "/edit-repuesto",
      params: { id: String(id) },
    });
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />

      {/* Franja superior roja */}
      <SafeAreaView style={styles.headerSafeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setSidebarVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="menu" size={28} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerText}>Inventario</Text>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={abrirNuevo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="add-circle" size={30} color={COLORS.yellow} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Buscador en vivo */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={COLORS.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre o código..."
          placeholderTextColor={COLORS.placeholder}
          value={busqueda}
          onChangeText={setBusqueda}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {hayBusqueda && (
          <Ionicons
            name="close-circle"
            size={18}
            color={COLORS.placeholder}
            onPress={() => setBusqueda("")}
          />
        )}
      </View>

      {cargando ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.red} />
        </View>
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(item) => String(item.id_repuesto)}
          renderItem={({ item }) => (
            <TarjetaRepuesto
              repuesto={item}
              onPress={() => abrirEditar(item.id_repuesto)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>Repuestos disponibles</Text>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {errorCarga
                ? "No se pudo cargar el inventario."
                : hayBusqueda
                  ? "No se encontraron repuestos."
                  : "Aún no hay repuestos. Toca + para crear uno."}
            </Text>
          }
          ListFooterComponent={<View style={{ height: 24 }} />}
        />
      )}

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
    </View>
  );
}

// ---------- Estilos ----------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
  headerSafeArea: {
    backgroundColor: COLORS.red,
  },
  header: {
    backgroundColor: COLORS.red,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 32,
    alignItems: "center",
  },
  headerText: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "700",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.cardDark,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.white,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 14,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
  productCard: {
    flexDirection: "row",
    backgroundColor: COLORS.cardDark,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
    marginBottom: 14,
  },
  cardDescontinuada: {
    opacity: 0.7,
  },
  productImage: {
    width: 96,
    height: 96,
    borderRadius: 10,
    backgroundColor: COLORS.cardBorder,
  },
  imageFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    gap: 3,
  },
  productName: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "800",
  },
  productCode: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  tagsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagStd: { backgroundColor: "#3A4A5A" },
  tagEsp: { backgroundColor: "#5A4A2A" },
  tagDesc: { backgroundColor: "#555555" },
  tagText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "700",
  },
  stockText: {
    color: COLORS.green,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  stockBajo: {
    color: COLORS.red,
  },
  productPrice: {
    color: COLORS.yellow,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  sinPrecio: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 2,
  },
});
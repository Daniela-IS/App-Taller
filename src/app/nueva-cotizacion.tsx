import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    BackHandler,
    Image,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import SearchableSelect from "../components/SearchableSelect";
import {
    getRepuestosConPrecio,
    getServicios,
    getTiposDocumentoExternos,
    STOCK_BAJO,
    type RepuestoConPrecio,
    type ServicioCatalogo,
    type TipoDocumentoExterno,
} from "../db/catalogos";
import { CotizacionError } from "../db/cotizacion-error";
import { crearCotizacion, type NuevaCotizacionInput } from "../db/cotizaciones";
import {
    getVehiculosConDetalle,
    type VehiculoConDetalle,
} from "../db/database";
import {
    esUrlImagenValida,
    filtrarNumerico,
    parseNumeroNoNegativo,
} from "../utils/validaciones";

const COLORS = {
  bgDark: "#121212",
  red: "#C1272D",
  cardDark: "#2A2A2A",
  cardBorder: "#3A3A3A",
  inputBg: "#1e272e",
  white: "#FFFFFF",
  textMuted: "#A8A8A8",
  placeholder: "#a4b0be",
};

const MAX_FOTOS = 5;

// ---------- Tipos ----------
interface LineaCarrito {
  clave: string;
  tipo_item: "Repuesto" | "Servicio";
  id_item: number;
  nombre: string;
  cantidad: number;
  precioTexto: string;
  stock: number | null; // solo repuestos
}

type Pestana = "Repuestos" | "Servicios";

// ---------- Utilidades ----------
const formatearSoles = (monto: number): string => `S/ ${monto.toFixed(2)}`;
const claveLinea = (tipo: "Repuesto" | "Servicio", id: number): string =>
  `${tipo}:${id}`;

// ---------- Componentes internos ----------
function ImagenRepuesto({ uri }: { uri: string | null }) {
  const [error, setError] = useState(false);

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
  enCarrito,
  onPress,
}: {
  repuesto: RepuestoConPrecio;
  enCarrito: boolean;
  onPress: () => void;
}) {
  const agotado = repuesto.stock_actual <= 0;
  const stockBajo = repuesto.stock_actual <= STOCK_BAJO;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={agotado}
      style={[
        styles.productCard,
        enCarrito && styles.productCardSelected,
        agotado && styles.productCardDisabled,
      ]}
    >
      <View>
        <ImagenRepuesto uri={repuesto.url_imagen} />
        {agotado && (
          <View style={styles.badgeAgotado}>
            <Text style={styles.badgeAgotadoText}>Agotado</Text>
          </View>
        )}
      </View>
      <Text style={styles.productName} numberOfLines={1}>
        {repuesto.nombre}
      </Text>
      <Text style={styles.productCode} numberOfLines={1}>
        {repuesto.codigo_referencia ?? "—"}
      </Text>
      <Text style={[styles.productStock, stockBajo && styles.stockBajo]}>
        Stock: {repuesto.stock_actual}
      </Text>
      {repuesto.mejor_precio !== null ? (
        <Text style={styles.productPrice}>
          {formatearSoles(repuesto.mejor_precio)}
        </Text>
      ) : (
        <Text style={styles.productNoPrice}>Sin precio</Text>
      )}
    </TouchableOpacity>
  );
}

function FilaServicio({
  servicio,
  enCarrito,
  onPress,
}: {
  servicio: ServicioCatalogo;
  enCarrito: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.serviceRow, enCarrito && styles.productCardSelected]}
    >
      <View style={styles.serviceInfo}>
        <Text style={styles.productName} numberOfLines={2}>
          {servicio.nombre}
        </Text>
        {!!servicio.descripcion && (
          <Text style={styles.serviceDesc} numberOfLines={2}>
            {servicio.descripcion}
          </Text>
        )}
      </View>
      <Text style={styles.productPrice}>
        {formatearSoles(servicio.precio_referencial)}
      </Text>
    </TouchableOpacity>
  );
}

function MiniFoto({ uri, onQuitar }: { uri: string; onQuitar: () => void }) {
  const [error, setError] = useState(false);
  return (
    <View style={styles.photoWrap}>
      {error ? (
        <View style={[styles.photo, styles.imageFallback]}>
          <Ionicons name="image-outline" size={26} color={COLORS.textMuted} />
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={styles.photo}
          resizeMode="cover"
          onError={() => setError(true)}
        />
      )}
      <TouchableOpacity
        style={styles.photoRemove}
        onPress={onQuitar}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="close" size={14} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

// ---------- Pantalla principal ----------
export default function NuevaCotizacionScreen() {
  const router = useRouter();

  // --- Carga ---
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [vehiculos, setVehiculos] = useState<VehiculoConDetalle[]>([]);
  const [tiposDoc, setTiposDoc] = useState<TipoDocumentoExterno[]>([]);
  const [repuestos, setRepuestos] = useState<RepuestoConPrecio[]>([]);
  const [servicios, setServicios] = useState<ServicioCatalogo[]>([]);

  // --- Formulario ---
  const [idActivo, setIdActivo] = useState<string | null>(null);
  const [idTipoDoc, setIdTipoDoc] = useState<number | null>(null);
  const [pestana, setPestana] = useState<Pestana>("Repuestos");
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [fotos, setFotos] = useState<string[]>([]);
  const [urlFoto, setUrlFoto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardadoRef = useRef(false);

  const cargarDatos = useCallback(async () => {
    try {
      setCargando(true);
      setErrorCarga(null);
      const [v, t, r, s] = await Promise.all([
        getVehiculosConDetalle(),
        getTiposDocumentoExternos(),
        getRepuestosConPrecio(),
        getServicios(),
      ]);
      // Un activo con varios medidores llega repetido: se deduplica por id_activo.
      const vistos = new Set<number>();
      setVehiculos(
        v.filter((x) => {
          if (vistos.has(x.id_activo)) return false;
          vistos.add(x.id_activo);
          return true;
        }),
      );
      setTiposDoc(t);
      setRepuestos(r.filter((x) => x.estado_operativo === "Activo"));
      setServicios(s);
      setIdTipoDoc((prev) => prev ?? t[0]?.id_tipo_documento ?? null);
    } catch (error) {
      console.error(error);
      setErrorCarga("No se pudieron cargar los datos de la cotización.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // --- Salir (flecha y botón físico) ---
  const salir = useCallback(() => {
    if (carrito.length === 0 || guardadoRef.current) {
      router.back();
      return;
    }
    Alert.alert(
      "¿Salir sin guardar?",
      "Se perderán los ítems agregados a la cotización.",
      [
        { text: "Seguir editando", style: "cancel" },
        { text: "Salir", style: "destructive", onPress: () => router.back() },
      ],
    );
  }, [carrito.length, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      salir();
      return true;
    });
    return () => sub.remove();
  }, [salir]);

  // --- Carrito ---
  const agregarRepuesto = (r: RepuestoConPrecio) => {
    if (r.stock_actual <= 0) return;
    const clave = claveLinea("Repuesto", r.id_repuesto);
    const existente = carrito.find((l) => l.clave === clave);

    if (existente) {
      if (existente.stock !== null && existente.cantidad >= existente.stock) {
        Alert.alert(
          "Stock máximo",
          `Solo hay ${existente.stock} unidades de "${r.nombre}".`,
        );
        return;
      }
      setCarrito((prev) =>
        prev.map((l) =>
          l.clave === clave ? { ...l, cantidad: l.cantidad + 1 } : l,
        ),
      );
      return;
    }

    setCarrito((prev) => [
      ...prev,
      {
        clave,
        tipo_item: "Repuesto",
        id_item: r.id_repuesto,
        nombre: r.nombre,
        cantidad: 1,
        precioTexto: r.mejor_precio !== null ? r.mejor_precio.toFixed(2) : "",
        stock: r.stock_actual,
      },
    ]);
  };

  const agregarServicio = (s: ServicioCatalogo) => {
    const clave = claveLinea("Servicio", s.id_servicio);
    if (carrito.some((l) => l.clave === clave)) {
      setCarrito((prev) =>
        prev.map((l) =>
          l.clave === clave ? { ...l, cantidad: l.cantidad + 1 } : l,
        ),
      );
      return;
    }
    setCarrito((prev) => [
      ...prev,
      {
        clave,
        tipo_item: "Servicio",
        id_item: s.id_servicio,
        nombre: s.nombre,
        cantidad: 1,
        precioTexto: s.precio_referencial.toFixed(2),
        stock: null,
      },
    ]);
  };

  const cambiarCantidad = (clave: string, delta: number) => {
    setCarrito((prev) =>
      prev.map((l) => {
        if (l.clave !== clave) return l;
        const nueva = l.cantidad + delta;
        if (nueva < 1) return l;
        if (l.stock !== null && nueva > l.stock) return l;
        return { ...l, cantidad: nueva };
      }),
    );
  };

  const cambiarPrecio = (clave: string, texto: string) => {
    setCarrito((prev) =>
      prev.map((l) =>
        l.clave === clave ? { ...l, precioTexto: filtrarNumerico(texto) } : l,
      ),
    );
  };

  const quitarLinea = (clave: string) =>
    setCarrito((prev) => prev.filter((l) => l.clave !== clave));

  const total = useMemo(
    () =>
      carrito.reduce(
        (acc, l) =>
          acc + l.cantidad * (parseNumeroNoNegativo(l.precioTexto) ?? 0),
        0,
      ),
    [carrito],
  );

  // --- Fotos ---
  const agregarFoto = () => {
    const url = urlFoto.trim();
    if (!url) return;
    if (fotos.length >= MAX_FOTOS) {
      Alert.alert(
        "Límite alcanzado",
        `Máximo ${MAX_FOTOS} fotos por cotización.`,
      );
      return;
    }
    if (!esUrlImagenValida(url)) {
      Alert.alert(
        "URL inválida",
        "Ingresa una URL que empiece con http:// o https://, sin espacios.",
      );
      return;
    }
    if (fotos.includes(url)) {
      Alert.alert("Foto repetida", "Esa URL ya fue agregada.");
      return;
    }
    setFotos((prev) => [...prev, url]);
    setUrlFoto("");
  };

  // --- Guardar ---
  const handleGuardar = async () => {
    if (idActivo === null) {
      Alert.alert("Falta el activo", "Selecciona el activo de la cotización.");
      return;
    }
    if (idTipoDoc === null) {
      Alert.alert(
        "Falta el tipo de documento",
        "Selecciona un tipo de documento.",
      );
      return;
    }
    if (carrito.length === 0) {
      Alert.alert(
        "Cotización vacía",
        "Agrega al menos un repuesto o servicio.",
      );
      return;
    }

    const lineas: NuevaCotizacionInput["lineas"] = [];
    for (const l of carrito) {
      if (!Number.isInteger(l.cantidad) || l.cantidad < 1) {
        Alert.alert(
          "Cantidad inválida",
          `La cantidad de "${l.nombre}" debe ser un entero mayor o igual a 1.`,
        );
        return;
      }
      const precio = parseNumeroNoNegativo(l.precioTexto);
      if (precio === null || precio <= 0) {
        Alert.alert(
          "Precio inválido",
          `Ingresa un precio mayor a 0 para "${l.nombre}".`,
        );
        return;
      }
      lineas.push({
        tipo_item: l.tipo_item,
        id_item: l.id_item,
        cantidad: l.cantidad,
        precio_unitario: precio,
      });
    }

    try {
      setGuardando(true);
      const id = await crearCotizacion({
        id_activo: Number(idActivo),
        id_tipo_documento: idTipoDoc,
        lineas,
        fotos,
      });
      guardadoRef.current = true;
      const numero = String(id).padStart(4, "0");
      Alert.alert(
        `Cotización N° ${numero} creada`,
        "Se guardó correctamente.",
        [
          {
            text: "OK",
            onPress: () =>
              // CONTRATO con frente C: la ruta /cotizacion-detalle la crea otro frente
              router.replace({
                pathname: "/cotizacion-detalle",
                params: { id: String(id) },
              } as never),
          },
        ],
      );
    } catch (error) {
      setGuardando(false);
      if (error instanceof CotizacionError) {
        Alert.alert("No se pudo guardar", error.message);
      } else {
        console.error(error);
        Alert.alert(
          "Error",
          "No se pudo guardar la cotización. Intenta nuevamente.",
        );
      }
    }
  };

  // --- Render ---
  const encabezado = (
    <SafeAreaView style={styles.headerSafeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={salir}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={26} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerText}>Nueva cotización</Text>
        <View style={styles.menuButtonSpacer} />
      </View>
    </SafeAreaView>
  );

  if (cargando) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />
        {encabezado}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.red} />
        </View>
      </View>
    );
  }

  if (errorCarga) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />
        {encabezado}
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorCarga}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void cargarDatos()}
          >
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{ headerShown: false, gestureEnabled: carrito.length === 0 }}
      />
      <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />
      {encabezado}

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* a. Activo */}
        <SearchableSelect<VehiculoConDetalle>
          label="Activo *"
          items={vehiculos}
          getId={(v) => String(v.id_activo)}
          getLabel={(v) =>
            `${v.placa && v.placa.trim() !== "" ? v.placa : "Sin placa"} · ${v.nombre_cliente}`
          }
          selectedId={idActivo}
          onSelect={setIdActivo}
          placeholder="Selecciona un activo"
        />

        {/* b. Tipo de documento */}
        <Text style={styles.label}>Tipo de documento</Text>
        <View style={styles.chipsRow}>
          {tiposDoc.map((t) => {
            const activo = t.id_tipo_documento === idTipoDoc;
            return (
              <TouchableOpacity
                key={t.id_tipo_documento}
                style={[styles.chip, activo && styles.chipActive]}
                onPress={() => setIdTipoDoc(t.id_tipo_documento)}
              >
                <Text
                  style={[styles.chipText, activo && styles.chipTextActive]}
                >
                  {t.nombre}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* c. Pestañas */}
        <View style={styles.tabsRow}>
          {(["Repuestos", "Servicios"] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.tab, pestana === p && styles.tabActive]}
              onPress={() => setPestana(p)}
            >
              <Text
                style={[styles.tabText, pestana === p && styles.tabTextActive]}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {pestana === "Repuestos" ? (
          repuestos.length === 0 ? (
            <Text style={styles.emptyText}>No hay repuestos activos.</Text>
          ) : (
            <View style={styles.grid}>
              {repuestos.map((r) => (
                <TarjetaRepuesto
                  key={r.id_repuesto}
                  repuesto={r}
                  enCarrito={carrito.some(
                    (l) => l.clave === claveLinea("Repuesto", r.id_repuesto),
                  )}
                  onPress={() => agregarRepuesto(r)}
                />
              ))}
            </View>
          )
        ) : servicios.length === 0 ? (
          <Text style={styles.emptyText}>No hay servicios en el catálogo.</Text>
        ) : (
          servicios.map((s) => (
            <FilaServicio
              key={s.id_servicio}
              servicio={s}
              enCarrito={carrito.some(
                (l) => l.clave === claveLinea("Servicio", s.id_servicio),
              )}
              onPress={() => agregarServicio(s)}
            />
          ))
        )}

        {/* d. Carrito */}
        <Text style={styles.sectionTitle}>Detalle de la cotización</Text>
        {carrito.length === 0 ? (
          <Text style={styles.emptyText}>
            Toca un repuesto o servicio para agregarlo.
          </Text>
        ) : (
          carrito.map((l) => {
            const precio = parseNumeroNoNegativo(l.precioTexto) ?? 0;
            const enMax = l.stock !== null && l.cantidad >= l.stock;
            return (
              <View key={l.clave} style={styles.cartCard}>
                <View style={styles.cartTop}>
                  <View style={styles.cartNameBox}>
                    <Text style={styles.cartName} numberOfLines={2}>
                      {l.nombre}
                    </Text>
                    <Text style={styles.cartType}>
                      {l.tipo_item}
                      {l.stock !== null ? ` · Máx. ${l.stock}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => quitarLinea(l.clave)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash" size={20} color={COLORS.red} />
                  </TouchableOpacity>
                </View>

                <View style={styles.cartBottom}>
                  <View style={styles.counter}>
                    <TouchableOpacity
                      style={[
                        styles.counterButton,
                        l.cantidad <= 1 && styles.counterButtonDisabled,
                      ]}
                      onPress={() => cambiarCantidad(l.clave, -1)}
                      disabled={l.cantidad <= 1}
                    >
                      <Ionicons name="remove" size={18} color={COLORS.white} />
                    </TouchableOpacity>
                    <Text style={styles.counterValue}>{l.cantidad}</Text>
                    <TouchableOpacity
                      style={[
                        styles.counterButton,
                        enMax && styles.counterButtonDisabled,
                      ]}
                      onPress={() => cambiarCantidad(l.clave, 1)}
                      disabled={enMax}
                    >
                      <Ionicons name="add" size={18} color={COLORS.white} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.priceBox}>
                    <Text style={styles.pricePrefix}>S/</Text>
                    <TextInput
                      style={styles.priceInput}
                      value={l.precioTexto}
                      onChangeText={(t) => cambiarPrecio(l.clave, t)}
                      keyboardType="decimal-pad"
                      placeholder="Precio"
                      placeholderTextColor={COLORS.placeholder}
                    />
                  </View>

                  <Text style={styles.cartSubtotal}>
                    {formatearSoles(l.cantidad * precio)}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        {/* f. Fotos */}
        <Text style={styles.sectionTitle}>
          Fotos (opcional) · {fotos.length}/{MAX_FOTOS}
        </Text>
        <View style={styles.photoInputRow}>
          <TextInput
            style={styles.photoInput}
            value={urlFoto}
            onChangeText={setUrlFoto}
            placeholder="https://..."
            placeholderTextColor={COLORS.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.photoAddButton} onPress={agregarFoto}>
            <Text style={styles.photoAddText}>Agregar</Text>
          </TouchableOpacity>
        </View>
        {fotos.length > 0 && (
          <View style={styles.photosRow}>
            {fotos.map((url) => (
              <MiniFoto
                key={url}
                uri={url}
                onQuitar={() =>
                  setFotos((prev) => prev.filter((u) => u !== url))
                }
              />
            ))}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* e + g. Total y guardar */}
      <View style={styles.footer}>
        <View style={styles.footerTop}>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerTotal}>{formatearSoles(total)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.saveButton, guardando && styles.saveButtonDisabled]}
          onPress={() => void handleGuardar()}
          disabled={guardando}
          activeOpacity={0.85}
        >
          {guardando ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.saveButtonText}>Guardar cotización</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------- Estilos ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  headerSafeArea: { backgroundColor: COLORS.red },
  header: {
    backgroundColor: COLORS.red,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuButton: { width: 28 },
  menuButtonSpacer: { width: 28 },
  headerText: { color: COLORS.white, fontSize: 20, fontWeight: "700" },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingTop: 8 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.white,
    marginTop: 15,
    marginBottom: 8,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardDark,
  },
  chipActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText: { color: COLORS.textMuted, fontWeight: "600", fontSize: 14 },
  chipTextActive: { color: COLORS.white },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.cardDark,
    borderRadius: 12,
    padding: 4,
    marginTop: 22,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: COLORS.red },
  tabText: { color: COLORS.textMuted, fontWeight: "700", fontSize: 14 },
  tabTextActive: { color: COLORS.white },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  productCard: {
    width: "48%",
    backgroundColor: COLORS.cardDark,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.cardBorder,
    padding: 10,
    marginBottom: 14,
  },
  productCardSelected: { borderColor: COLORS.red },
  productCardDisabled: { opacity: 0.55 },
  productImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: COLORS.cardBorder,
  },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  badgeAgotado: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: COLORS.red,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeAgotadoText: { color: COLORS.white, fontSize: 11, fontWeight: "800" },
  productName: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 10,
  },
  productCode: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  productStock: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  stockBajo: { color: COLORS.red, fontWeight: "700" },
  productPrice: {
    color: COLORS.red,
    fontSize: 17,
    fontWeight: "800",
    marginTop: 4,
  },
  productNoPrice: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 4,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.cardDark,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  serviceInfo: { flex: 1, marginRight: 12 },
  serviceDesc: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 12,
  },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginBottom: 8 },
  errorText: {
    color: COLORS.white,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: COLORS.red,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  cartCard: {
    backgroundColor: COLORS.cardDark,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  cartTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  cartNameBox: { flex: 1, marginRight: 12 },
  cartName: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
  cartType: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  cartBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  counter: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.bgDark,
    borderRadius: 10,
    padding: 3,
  },
  counterButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  counterButtonDisabled: { opacity: 0.4 },
  counterValue: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
    minWidth: 30,
    textAlign: "center",
  },
  priceBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: "#dfddd171",
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  pricePrefix: { color: COLORS.textMuted, fontSize: 14, marginRight: 4 },
  priceInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: 15,
    paddingVertical: 8,
  },
  cartSubtotal: {
    color: COLORS.red,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 78,
    textAlign: "right",
  },
  photoInputRow: { flexDirection: "row", gap: 8 },
  photoInput: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: "#dfddd171",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: COLORS.white,
    fontSize: 15,
  },
  photoAddButton: {
    backgroundColor: COLORS.red,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  photoAddText: { color: COLORS.white, fontWeight: "700", fontSize: 14 },
  photosRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  photoWrap: { width: 72, height: 72 },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: COLORS.cardBorder,
  },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    backgroundColor: COLORS.cardDark,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
  },
  footerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  footerLabel: { color: COLORS.textMuted, fontSize: 15, fontWeight: "700" },
  footerTotal: { color: COLORS.red, fontSize: 24, fontWeight: "800" },
  saveButton: {
    backgroundColor: COLORS.red,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

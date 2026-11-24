// Sin parámetro `id` = crear repuesto. Con `id` = editar.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { esUrlImagenValida } from "../utils/validaciones";
import { FormModal } from "../components/CatalogQuickAddModals";
import SearchableSelect from "../components/SearchableSelect";
import {
  actualizarRepuesto,
  ajustarStock,
  crearProveedor,
  crearRepuesto,
  eliminarRepuesto,
  getPreciosDeRepuesto,
  getProveedores,
  getRepuestoPorId,
  guardarPrecioProveedor,
  InventarioError,
  quitarPrecioProveedor,
  type PrecioDeRepuesto,
} from "../db/inventario";
import type { EstadoRepuesto, Proveedor } from "../db/types";

const COLORS = {
  bgDark: "#121212",
  red: "#C1272D",
  yellow: "#E8B923",
  white: "#FFFFFF",
  dark: "#2f3640",
  card: "#2A2A2A",
  cardBorder: "#3A3A3A",
  input: "#1e272e",
  inputBorder: "#4a5560",
  border: "#dcdde1",
  placeholder: "#a4b0be",
  muted: "#A8A8A8",
  green: "#3DBE5C",
};

/** Muestra el mensaje claro de InventarioError, o uno genérico. */
function mostrarError(titulo: string, e: unknown) {
  if (e instanceof InventarioError) {
    Alert.alert(titulo, e.message);
    return;
  }
  console.error(e);
  Alert.alert(titulo, "Ocurrió un error inesperado. Intenta nuevamente.");
}

const etiquetaProveedor = (p: Proveedor) => p.nombre_comercial || p.razon_social;

export default function EditRepuestoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const idParam = params.id ? Number(params.id) : null;

  // id del repuesto en edición. Tras crear uno nuevo, pasa a tener valor y
  // la pantalla queda en modo editar (para poder cargar precios).
  const [idActual, setIdActual] = useState<number | null>(
    idParam !== null && Number.isInteger(idParam) ? idParam : null,
  );
  const modoEditar = idActual !== null;

  const [cargandoInicial, setCargandoInicial] = useState(idActual !== null);
  const [guardando, setGuardando] = useState(false);

  // --- Campos ---
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [stock, setStock] = useState("0");
  const [esComercial, setEsComercial] = useState<0 | 1>(1); // 1 = Estándar, 0 = Especial
  const [estado, setEstado] = useState<EstadoRepuesto>("Activo");
  const [urlImagen, setUrlImagen] = useState("");
  const [errorImagen, setErrorImagen] = useState(false);

  // --- Proveedores y precios ---
  const [precios, setPrecios] = useState<PrecioDeRepuesto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [idProveedor, setIdProveedor] = useState<string | null>(null);
  const [precioNuevo, setPrecioNuevo] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);
  const [modalProveedorVisible, setModalProveedorVisible] = useState(false);

  const cargarPrecios = useCallback(async (id: number) => {
    try {
      setPrecios(await getPreciosDeRepuesto(id));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const cargarProveedores = useCallback(async () => {
    try {
      setProveedores(await getProveedores());
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Carga inicial al abrir en modo editar
  useEffect(() => {
    if (idParam === null || !Number.isInteger(idParam)) return;
    (async () => {
      try {
        const r = await getRepuestoPorId(idParam);
        if (!r) {
          Alert.alert("No encontrado", "El repuesto ya no existe.", [
            { text: "OK", onPress: () => router.back() },
          ]);
          return;
        }
        setNombre(r.nombre);
        setCodigo(r.codigo_referencia ?? "");
        setStock(String(r.stock_actual));
        setEsComercial(r.es_comercial);
        setEstado(r.estado_operativo);
        setUrlImagen(r.url_imagen ?? "");
        await Promise.all([cargarPrecios(idParam), cargarProveedores()]);
      } catch (e) {
        mostrarError("Error al cargar", e);
      } finally {
        setCargandoInicial(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si cambia la URL, se reinicia el estado de error de la vista previa
  useEffect(() => {
    setErrorImagen(false);
  }, [urlImagen]);

  // ---------------------------------------------------------------
  // Stock (+1 / −1)
  // ---------------------------------------------------------------
  const stockNumero = /^\d+$/.test(stock.trim()) ? Number(stock.trim()) : null;

  const cambiarStock = async (delta: 1 | -1) => {
    const base = stockNumero ?? 0;
    const nuevo = Math.max(0, base + delta);
    if (nuevo === base) return;
    setStock(String(nuevo));

    // En modo editar se guarda al instante (ajustarStock); en crear queda local.
    if (idActual !== null) {
      try {
        await ajustarStock(idActual, nuevo);
      } catch (e) {
        setStock(String(base)); // revierte si falló
        mostrarError("No se pudo ajustar el stock", e);
      }
    }
  };

  // ---------------------------------------------------------------
  // Guardar (crear / actualizar)
  // ---------------------------------------------------------------
  const handleGuardar = async () => {
    if (!nombre.trim()) {
      Alert.alert("Falta el nombre", "El nombre del repuesto es obligatorio.");
      return;
    }
    if (stockNumero === null) {
      Alert.alert(
        "Stock inválido",
        "El stock debe ser un número entero mayor o igual a 0.",
      );
      return;
    }
    const url = urlImagen.trim();
    if (url !== "" && !esUrlImagenValida(url)) {
      Alert.alert(
        "URL de imagen inválida",
        "Ingresa una URL válida (http/https) o deja el campo vacío.",
      );
      return;
    }

    const datos = {
      nombre: nombre.trim(),
      codigo_referencia: codigo.trim() === "" ? null : codigo.trim(), // vacío -> NULL
      stock_actual: stockNumero,
      es_comercial: esComercial,
      estado_operativo: estado,
      url_imagen: url === "" ? null : url,
    };

    try {
      setGuardando(true);
      if (idActual === null) {
        const nuevoId = await crearRepuesto(datos);
        setIdActual(nuevoId); // queda en modo editar
        await cargarProveedores();
        await cargarPrecios(nuevoId);
        Alert.alert(
          "¡Repuesto creado!",
          "Ahora puedes cargar los precios por proveedor en la sección de abajo.",
        );
      } else {
        await actualizarRepuesto(idActual, datos);
        Alert.alert("Guardado", "Los cambios se guardaron correctamente.");
      }
    } catch (e) {
      mostrarError("No se pudo guardar", e);
    } finally {
      setGuardando(false);
    }
  };

  // ---------------------------------------------------------------
  // Eliminar
  // ---------------------------------------------------------------
  const confirmarEliminar = () => {
    if (idActual === null) return;
    Alert.alert(
      "Eliminar repuesto",
      `¿Seguro que deseas eliminar "${nombre.trim() || "este repuesto"}"? Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await eliminarRepuesto(idActual);
              router.back();
            } catch (e) {
              mostrarError("No se pudo eliminar", e);
            }
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------
  // Precios por proveedor
  // ---------------------------------------------------------------
  const handleGuardarPrecio = async () => {
    if (idActual === null) return;
    if (!idProveedor) {
      Alert.alert("Falta el proveedor", "Selecciona un proveedor.");
      return;
    }
    const precio = Number(precioNuevo.trim().replace(",", "."));
    if (!precioNuevo.trim() || !Number.isFinite(precio) || precio <= 0) {
      Alert.alert("Precio inválido", "Ingresa un precio mayor a 0.");
      return;
    }
    try {
      setGuardandoPrecio(true);
      await guardarPrecioProveedor(idActual, Number(idProveedor), precio);
      setIdProveedor(null);
      setPrecioNuevo("");
      await cargarPrecios(idActual);
    } catch (e) {
      mostrarError("No se pudo guardar el precio", e);
    } finally {
      setGuardandoPrecio(false);
    }
  };

  const confirmarQuitarPrecio = (p: PrecioDeRepuesto) => {
    if (idActual === null) return;
    Alert.alert("Quitar precio", `¿Quitar el precio de "${p.nombre}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Quitar",
        style: "destructive",
        onPress: async () => {
          try {
            await quitarPrecioProveedor(idActual, p.id_proveedor);
            await cargarPrecios(idActual);
          } catch (e) {
            mostrarError("No se pudo quitar el precio", e);
          }
        },
      },
    ]);
  };

  // Tocar un precio existente lo precarga para corregirlo (guardar = actualiza)
  const editarPrecio = (p: PrecioDeRepuesto) => {
    setIdProveedor(String(p.id_proveedor));
    setPrecioNuevo(String(p.precio_ofrecido));
  };

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  const urlTrim = urlImagen.trim();
  const urlValida = urlTrim !== "" && esUrlImagenValida(urlTrim);
  const mejorPrecio = precios.length > 0 ? precios[0].precio_ofrecido : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />

      <SafeAreaView style={styles.headerSafeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={28} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerText}>
            {modoEditar ? "Editar repuesto" : "Nuevo repuesto"}
          </Text>
          <View style={styles.headerButton} />
        </View>
      </SafeAreaView>

      {cargandoInicial ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.red} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.form}>
              {/* Nombre */}
              <Text style={styles.label}>Nombre *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: Filtro de aceite"
                placeholderTextColor={COLORS.placeholder}
                value={nombre}
                onChangeText={setNombre}
              />

              {/* Código de referencia */}
              <Text style={styles.label}>Código de referencia</Text>
              <TextInput
                style={styles.input}
                placeholder="Opcional — debe ser único"
                placeholderTextColor={COLORS.placeholder}
                value={codigo}
                onChangeText={setCodigo}
                autoCapitalize="characters"
                autoCorrect={false}
              />

              {/* Stock */}
              <Text style={styles.label}>Stock *</Text>
              <View style={styles.stockRow}>
                <TouchableOpacity
                  style={styles.stockButton}
                  onPress={() => cambiarStock(-1)}
                >
                  <Ionicons name="remove" size={24} color={COLORS.white} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.stockInput]}
                  value={stock}
                  onChangeText={setStock}
                  keyboardType="number-pad"
                  textAlign="center"
                />
                <TouchableOpacity
                  style={styles.stockButton}
                  onPress={() => cambiarStock(1)}
                >
                  <Ionicons name="add" size={24} color={COLORS.white} />
                </TouchableOpacity>
              </View>

              {/* Tipo */}
              <Text style={styles.label}>Tipo</Text>
              <View style={styles.row}>
                <Chip
                  texto="Estándar"
                  activo={esComercial === 1}
                  onPress={() => setEsComercial(1)}
                />
                <Chip
                  texto="Especial"
                  activo={esComercial === 0}
                  onPress={() => setEsComercial(0)}
                />
              </View>

              {/* Estado */}
              <Text style={styles.label}>Estado</Text>
              <View style={styles.row}>
                <Chip
                  texto="Activo"
                  activo={estado === "Activo"}
                  onPress={() => setEstado("Activo")}
                />
                <Chip
                  texto="Descontinuado"
                  activo={estado === "Descontinuado"}
                  onPress={() => setEstado("Descontinuado")}
                />
              </View>

              {/* Imagen */}
              <Text style={styles.label}>URL de imagen</Text>
              <TextInput
                style={styles.input}
                placeholder="Opcional — https://..."
                placeholderTextColor={COLORS.placeholder}
                value={urlImagen}
                onChangeText={setUrlImagen}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {urlTrim !== "" && !urlValida && (
                <Text style={styles.errorText}>
                  La URL no es válida (debe empezar con http:// o https://).
                </Text>
              )}
              <View style={styles.previewBox}>
                {urlValida && !errorImagen ? (
                  <Image
                    source={{ uri: urlTrim }}
                    style={styles.previewImage}
                    resizeMode="cover"
                    onError={() => setErrorImagen(true)}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="car-cog"
                    size={44}
                    color={COLORS.muted}
                  />
                )}
              </View>
              {urlValida && errorImagen && (
                <Text style={styles.errorText}>
                  No se pudo cargar la imagen de esa URL.
                </Text>
              )}

              {/* Guardar */}
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleGuardar}
                disabled={guardando}
                activeOpacity={0.8}
              >
                {guardando ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {modoEditar ? "Guardar cambios" : "Crear repuesto"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* ----------- Proveedores y precios (solo modo editar) ----------- */}
            {modoEditar && (
              <View style={[styles.form, { marginTop: 16 }]}>
                <Text style={styles.sectionTitle}>Proveedores y precios</Text>

                {precios.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Sin precios cargados todavía.
                  </Text>
                ) : (
                  precios.map((p) => (
                    <View key={p.id_proveedor} style={styles.precioRow}>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => editarPrecio(p)}
                      >
                        <Text style={styles.precioNombre} numberOfLines={1}>
                          {p.nombre}
                        </Text>
                        {p.precio_ofrecido === mejorPrecio && (
                          <Text style={styles.mejorTag}>Mejor precio</Text>
                        )}
                      </TouchableOpacity>
                      <Text style={styles.precioValor}>
                        S/ {p.precio_ofrecido.toFixed(2)}
                      </Text>
                      <TouchableOpacity
                        onPress={() => confirmarQuitarPrecio(p)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="trash" size={20} color={COLORS.red} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}

                <View style={styles.divider} />

                <SearchableSelect<Proveedor>
                  label="Proveedor"
                  items={proveedores}
                  getId={(p) => String(p.id_proveedor)}
                  getLabel={etiquetaProveedor}
                  selectedId={idProveedor}
                  onSelect={setIdProveedor}
                  placeholder="Selecciona un proveedor"
                  onQuickAddPress={() => setModalProveedorVisible(true)}
                  quickAddLabel="+ Nuevo"
                />

                <Text style={styles.label}>Precio (S/)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ej: 268.35"
                  placeholderTextColor={COLORS.placeholder}
                  value={precioNuevo}
                  onChangeText={setPrecioNuevo}
                  keyboardType="decimal-pad"
                />

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleGuardarPrecio}
                  disabled={guardandoPrecio}
                  activeOpacity={0.8}
                >
                  {guardandoPrecio ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>
                      Agregar / actualizar precio
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Eliminar */}
            {modoEditar && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={confirmarEliminar}
                activeOpacity={0.8}
              >
                <Ionicons name="trash" size={18} color={COLORS.red} />
                <Text style={styles.deleteButtonText}>Eliminar repuesto</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <ModalNuevoProveedor
        visible={modalProveedorVisible}
        onClose={() => setModalProveedorVisible(false)}
        onCreated={(p) => {
          setProveedores((prev) => [...prev, p]);
          setIdProveedor(String(p.id_proveedor)); // queda seleccionado
        }}
      />
    </View>
  );
}

// =====================================================================
// Componentes auxiliares
// =====================================================================

function Chip({
  texto,
  activo,
  onPress,
}: {
  texto: string;
  activo: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, activo && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, activo && styles.chipTextActive]}>
        {texto}
      </Text>
    </TouchableOpacity>
  );
}

/** Alta rápida de Proveedor (mismo patrón que CatalogQuickAddModals). */
function ModalNuevoProveedor({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (proveedor: Proveedor) => void;
}) {
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [contacto, setContacto] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [guardando, setGuardando] = useState(false);

  const reset = () => {
    setRuc("");
    setRazonSocial("");
    setNombreComercial("");
    setContacto("");
    setUbicacion("");
  };

  const handleGuardar = async () => {
    try {
      setGuardando(true);
      const id = await crearProveedor(
        ruc,
        razonSocial,
        nombreComercial,
        contacto,
        ubicacion,
      );
      onCreated({
        id_proveedor: id,
        ruc: ruc.trim(),
        razon_social: razonSocial.trim(),
        nombre_comercial: nombreComercial.trim() || null,
        contacto: contacto.trim() || null,
        ubicacion: ubicacion.trim() || null,
      });
      reset();
      onClose();
    } catch (e) {
      mostrarError("No se pudo crear el proveedor", e);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <FormModal visible={visible} title="Nuevo Proveedor" onClose={onClose}>
      <Text style={modalStyles.label}>RUC *</Text>
      <TextInput
        style={modalStyles.input}
        placeholder="11 dígitos"
        placeholderTextColor={COLORS.placeholder}
        value={ruc}
        onChangeText={setRuc}
        keyboardType="numeric"
        maxLength={11}
      />

      <Text style={modalStyles.label}>Razón social *</Text>
      <TextInput
        style={modalStyles.input}
        placeholder="Ej: Repuestos Andinos SAC"
        placeholderTextColor={COLORS.placeholder}
        value={razonSocial}
        onChangeText={setRazonSocial}
      />

      <Text style={modalStyles.label}>Nombre comercial</Text>
      <TextInput
        style={modalStyles.input}
        placeholder="Opcional"
        placeholderTextColor={COLORS.placeholder}
        value={nombreComercial}
        onChangeText={setNombreComercial}
      />

      <Text style={modalStyles.label}>Contacto</Text>
      <TextInput
        style={modalStyles.input}
        placeholder="Opcional — teléfono o correo"
        placeholderTextColor={COLORS.placeholder}
        value={contacto}
        onChangeText={setContacto}
      />

      <Text style={modalStyles.label}>Ubicación</Text>
      <TextInput
        style={modalStyles.input}
        placeholder="Opcional"
        placeholderTextColor={COLORS.placeholder}
        value={ubicacion}
        onChangeText={setUbicacion}
      />

      <TouchableOpacity
        style={modalStyles.saveButton}
        onPress={handleGuardar}
        disabled={guardando}
      >
        {guardando ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={modalStyles.saveButtonText}>Guardar Proveedor</Text>
        )}
      </TouchableOpacity>
    </FormModal>
  );
}

// =====================================================================
// Estilos
// =====================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  headerSafeArea: { backgroundColor: COLORS.red },
  header: {
    backgroundColor: COLORS.red,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: { width: 32, alignItems: "center" },
  headerText: { color: COLORS.white, fontSize: 20, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16 },
  form: {
    backgroundColor: COLORS.card,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.white,
    marginBottom: 5,
    marginTop: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: COLORS.input,
    color: COLORS.white,
  },
  errorText: { color: COLORS.red, fontSize: 12, marginTop: 6 },
  emptyText: { color: COLORS.muted, fontSize: 14, marginVertical: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 5 },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: COLORS.input,
  },
  chipActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText: { color: COLORS.muted, fontWeight: "600" },
  chipTextActive: { color: COLORS.white },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stockInput: { flex: 1 },
  stockButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  previewBox: {
    marginTop: 10,
    height: 140,
    borderRadius: 10,
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  previewImage: { width: "100%", height: "100%" },
  primaryButton: {
    backgroundColor: COLORS.red,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 28,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 16, fontWeight: "bold" },
  secondaryButton: {
    backgroundColor: COLORS.yellow,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
  },
  secondaryButtonText: { color: "#1A1A1A", fontSize: 15, fontWeight: "700" },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.red,
  },
  deleteButtonText: { color: COLORS.red, fontSize: 15, fontWeight: "700" },
  precioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  precioNombre: { color: COLORS.white, fontSize: 15, fontWeight: "600" },
  mejorTag: { color: COLORS.green, fontSize: 11, fontWeight: "700" },
  precioValor: { color: COLORS.yellow, fontSize: 15, fontWeight: "800" },
  divider: {
    height: 1,
    backgroundColor: COLORS.cardBorder,
    marginTop: 12,
  },
});

// Estilos del modal de alta rápida (tarjeta blanca de FormModal)
const modalStyles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.dark,
    marginBottom: 5,
    marginTop: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#f8f9fa",
    color: COLORS.dark,
  },
  saveButton: {
    backgroundColor: COLORS.red,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 25,
    marginBottom: 10,
  },
  saveButtonText: { color: COLORS.white, fontSize: 16, fontWeight: "bold" },
});

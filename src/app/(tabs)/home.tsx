import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Sidebar from "../../components/Sidebar";
import {
  getResumenHome,
  getVehiculosRecientes,
  type EstadoVehiculoHome,
  type ResumenHome,
  type VehiculoRecienteHome,
} from "../../db/home";
import { getSesion } from "../../db/sesion";

// ---------- Colores institucionales ----------
const COLORS = {
  bgDark: "#121212",
  red: "#C1272D",
  cardGray: "#9A9A9A",
  cardGrayDark: "#2A2A2A",
  yellow: "#E8B923",
  green: "#3DBE5C",
  white: "#FFFFFF",
  textLight: "#EDEDED",
};

const RESUMEN_VACIO: ResumenHome = {
  vehiculosActivos: 0,
  cotizacionesPendientes: 0,
  vehiculosListos: 0,
};

// ---------- Componentes internos ----------
function EstadoBadge({ estado }: { estado: EstadoVehiculoHome }) {
  const isListo = estado === "Listo";
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: isListo ? COLORS.green : COLORS.yellow },
      ]}
    >
      <Text style={styles.badgeText}>{estado}</Text>
    </View>
  );
}

function VehiculoIcon({ tipoUnidad }: { tipoUnidad: string }) {
  const name = tipoUnidad === "Camión" ? "truck" : "car";
  return <MaterialCommunityIcons name={name} size={40} color={COLORS.bgDark} />;
}

function TarjetaResumen({
  icono,
  numero,
  label,
}: {
  icono: React.ReactNode;
  numero: number;
  label: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryBadge}>
        <Text style={styles.summaryBadgeText}>{numero}</Text>
      </View>
      <View style={styles.summaryIconWrapper}>{icono}</View>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function TarjetaVehiculoReciente({
  vehiculo,
}: {
  vehiculo: VehiculoRecienteHome;
}) {
  return (
    <View style={styles.vehicleCard}>
      <View style={styles.vehicleIconCircle}>
        <VehiculoIcon tipoUnidad={vehiculo.tipo_unidad} />
      </View>
      <View style={styles.vehicleInfo}>
        <Text style={styles.vehiclePlaca}>{vehiculo.placa ?? "Sin placa"}</Text>
        <Text style={styles.vehicleModelo}>
          {vehiculo.marca ?? "Sin marca"} · {vehiculo.tipo_unidad}
        </Text>
      </View>
      <EstadoBadge estado={vehiculo.estado} />
    </View>
  );
}

// ---------- Pantalla principal ----------
export default function HomeScreen() {
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [resumen, setResumen] = useState<ResumenHome>(RESUMEN_VACIO);
  const [vehiculosRecientes, setVehiculosRecientes] = useState<
    VehiculoRecienteHome[]
  >([]);
  const [cargado, setCargado] = useState(false);
  const sesion = getSesion();

  // Se recarga cada vez que la pestaña vuelve a estar visible: al crear o
  // aprobar/rechazar una cotización, los números y la lista se actualizan solos.
  useFocusEffect(
    useCallback(() => {
      let cancelado = false;

      const cargarDatos = async () => {
        try {
          const [resumenActual, recientes] = await Promise.all([
            getResumenHome(),
            getVehiculosRecientes(5),
          ]);
          if (cancelado) return;
          setResumen(resumenActual);
          setVehiculosRecientes(recientes);
          setCargado(true);
        } catch (error) {
          if (!cancelado) {
            console.error("No se pudieron cargar los datos de Home:", error);
          }
        }
      };

      cargarDatos();
      return () => {
        cancelado = true;
      };
    }, []),
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.red} />

      {/* Franja superior roja */}
      <SafeAreaView style={styles.headerSafeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setSidebarVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={28} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerText} numberOfLines={1}>
            {sesion?.nombre ? `Bienvenido ${sesion.nombre}` : "Bienvenido"}
          </Text>
          <View style={styles.menuButtonSpacer} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Tarjetas de resumen */}
        <View style={styles.summaryRow}>
          <TarjetaResumen
            icono={
              <MaterialCommunityIcons
                name="car"
                size={38}
                color={COLORS.yellow}
              />
            }
            numero={resumen.vehiculosActivos}
            label={"Vehículos\nActivos"}
          />
          <TarjetaResumen
            icono={
              <MaterialCommunityIcons
                name="file-document-edit"
                size={38}
                color="#E8672A"
              />
            }
            numero={resumen.cotizacionesPendientes}
            label={"Cotizaciones\nPendientes"}
          />
          <TarjetaResumen
            icono={
              <Ionicons name="checkmark-sharp" size={40} color={COLORS.green} />
            }
            numero={resumen.vehiculosListos}
            label={"Vehículos\nListos"}
          />
        </View>

        {/* Sección vehículos recientes */}
        <Text style={styles.sectionTitle}>Vehículos Recientes</Text>

        {cargado && vehiculosRecientes.length === 0 ? (
          <Text style={styles.emptyText}>Aún no hay vehículos registrados.</Text>
        ) : (
          vehiculosRecientes.map((vehiculo) => (
            <TarjetaVehiculoReciente
              key={vehiculo.id_activo}
              vehiculo={vehiculo}
            />
          ))
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
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
  menuButton: {
    width: 28,
  },
  menuButtonSpacer: {
    width: 28,
  },
  headerText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginHorizontal: 8,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: COLORS.cardGray,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    marginHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 110,
  },
  summaryBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: COLORS.yellow,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.bgDark,
  },
  summaryIconWrapper: {
    marginBottom: 8,
  },
  summaryLabel: {
    color: COLORS.bgDark,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 16,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 14,
  },
  emptyText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 14,
  },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.cardGray,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  vehicleIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehiclePlaca: {
    color: COLORS.bgDark,
    fontSize: 18,
    fontWeight: "800",
  },
  vehicleModelo: {
    color: COLORS.bgDark,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  badgeText: {
    color: COLORS.bgDark,
    fontSize: 12,
    fontWeight: "700",
  },
});

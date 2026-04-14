import React from "react";
import {
  TouchableOpacity,
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Image,
} from "react-native";
import type { Provider } from "../types";

const PROVIDERS: Record<
  Provider,
  { name: string; subtitle: string; color: string; logoUri: string }
> = {
  khalti: {
    name: "Khalti",
    subtitle: "Digital wallet & bank transfer",
    color: "#5C2D91",
    logoUri: "https://cdn.brandfetch.io/domain/khalti.com?c=1idpK8WCPDflcXYNlms",
  },
  esewa: {
    name: "eSewa",
    subtitle: "Digital wallet & online banking",
    color: "#60BB46",
    logoUri: "https://cdn.brandfetch.io/domain/esewa.com.np?c=1idpK8WCPDflcXYNlms",
  },
};

type Props = {
  provider: Provider;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function ProviderButton({ provider, onPress, loading, disabled }: Props) {
  const meta = PROVIDERS[provider];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <View style={styles.left}>
        <Image
          source={{ uri: meta.logoUri }}
          style={styles.logo}
          resizeMode="contain"
        />
        <View>
          <Text style={styles.name}>{meta.name}</Text>
          <Text style={styles.subtitle}>{meta.subtitle}</Text>
        </View>
      </View>
      <View style={[styles.badge, { backgroundColor: meta.color }]}>
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.badgeText}>Pay</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#F0F0F0",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111",
  },
  subtitle: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 52,
    alignItems: "center",
  },
  badgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});

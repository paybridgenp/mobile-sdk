import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import qrcode from "qrcode-generator";

type Props = { value: string; size?: number; color?: string; backgroundColor?: string };

/** A View-based QR renderer: qrcode-generator is pure JS, so this has no native linking step. */
export function NativeQr({ value, size = 224, color = "#111", backgroundColor = "#fff" }: Props) {
  const matrix = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    return Array.from({ length: count }, (_, row) =>
      Array.from({ length: count }, (_, column) => code.isDark(row, column)),
    );
  }, [value]);
  const cell = size / matrix.length;

  return (
    <View accessible accessibilityRole="image" style={[styles.code, { width: size, height: size, backgroundColor }]} accessibilityLabel="Fonepay QR code">
      {matrix.map((row, y) => row.map((dark, x) => dark ? (
        <View key={`${x}-${y}`} style={{ position: "absolute", left: x * cell, top: y * cell, width: cell + 0.15, height: cell + 0.15, backgroundColor: color }} />
      ) : null))}
    </View>
  );
}

const styles = StyleSheet.create({ code: { overflow: "hidden" } });

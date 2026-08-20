declare module "qrcode-generator" {
  type QrCode = {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, column: number): boolean;
  };

  function qrcode(typeNumber: number, errorCorrectionLevel: string): QrCode;
  export default qrcode;
}

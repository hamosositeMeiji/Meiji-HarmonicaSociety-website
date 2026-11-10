/* Re-encode uploaded images through canvas so EXIF/IPTC/XMP metadata is not retained. */
(() => {
  async function prepare(file) {
    let source, bitmap = null, objectUrl = "";
    try {
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(file);
        source = bitmap;
      } else {
        objectUrl = URL.createObjectURL(file);
        source = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("画像を開けません。別の画像形式でお試しください"));
          image.src = objectUrl;
        });
      }
      const width = source.width || source.naturalWidth;
      const height = source.height || source.naturalHeight;
      if (!width || !height || width * height > 20000000) throw new Error("画像サイズが大きすぎます（最大2,000万画素）");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を安全に変換できません");
      context.drawImage(source, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error("画像の変換に失敗しました")), file.type, file.type === "image/jpeg" ? 0.92 : undefined);
      });
      if (blob.type !== file.type) throw new Error("このブラウザでは画像を変換できません。JPEG・PNG・WebPの別形式でお試しください");
      if (blob.size > 1500 * 1024) throw new Error("変換後の画像が1.5MBを超えました。画像を小さくして再度お試しください");
      return blob;
    } finally {
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  window.hamosoPrepareImage = prepare;
})();
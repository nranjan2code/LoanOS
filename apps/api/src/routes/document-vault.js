import { listDocumentVaultRecords } from "@loanos/core";

export async function routeDocumentVault(context) {
  const { method, path, url, req, res, store, sendJson } = context;

  if (method === "GET" && path === "/document-vault") {
    const state = await store.load();
    const records = listDocumentVaultRecords(state.documentVault, {
      applicationId: url.searchParams.get("applicationId") ?? undefined,
      borrowerId: url.searchParams.get("borrowerId") ?? undefined,
      packetId: url.searchParams.get("packetId") ?? undefined
    });
    sendJson(res, 200, {
      count: records.length,
      records
    });
    return true;
  }

  const documentVaultMatch = path.match(/^\/document-vault\/([^/]+)$/);
  if (method === "GET" && documentVaultMatch) {
    const state = await store.load();
    const vaultRecordId = decodeURIComponent(documentVaultMatch[1]);
    const record = state.documentVault?.[vaultRecordId];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document vault record not found." } });
      return true;
    }
    sendJson(res, 200, record);
    return true;
  }

  const documentVaultDownloadMatch = path.match(/^\/document-vault\/([^/]+)\/documents\/([^/]+)$/);
  if (method === "GET" && documentVaultDownloadMatch) {
    const state = await store.load();
    const vaultRecordId = decodeURIComponent(documentVaultDownloadMatch[1]);
    const documentId = decodeURIComponent(documentVaultDownloadMatch[2]);
    const record = state.documentVault?.[vaultRecordId];
    if (!record) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document vault record not found." } });
      return true;
    }
    const application = state.loanApplications?.[record.applicationId];
    if (!application) {
      sendJson(res, 404, { error: { code: "not_found", message: "Source loan application not found." } });
      return true;
    }
    const fullDoc = (application.documentPacket?.documents ?? []).find(d => d.documentId === documentId);
    if (!fullDoc) {
      sendJson(res, 404, { error: { code: "not_found", message: "Document not found in packet." } });
      return true;
    }

    const format = url.searchParams.get("format") || req.headers["accept"] || "application/json";
    if (format.includes("application/pdf")) {
      const pdfBuffer = Buffer.from(fullDoc.pdf, "base64");
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdfBuffer.length,
        "Content-Disposition": `attachment; filename="${fullDoc.type}.pdf"`
      });
      res.end(pdfBuffer);
      return true;
    } else if (format.includes("text/html")) {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(fullDoc.html),
        "Content-Disposition": `inline; filename="${fullDoc.type}.html"`
      });
      res.end(fullDoc.html);
      return true;
    }

    sendJson(res, 200, fullDoc);
    return true;
  }

  return false;
}

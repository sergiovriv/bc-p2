// src/App.js
import React, { useEffect, useState } from "react";
import "./App.css";
import { ethers } from "ethers";

import logo from "./ethereumLogo.png";
import { addresses, abis } from "./contracts";

const rpcProvider = new ethers.providers.JsonRpcProvider(
  "http://127.0.0.1:8545"
);


const ipfsContract = new ethers.Contract(
  addresses.ipfs,
  abis.ipfs,
  rpcProvider
);


async function fetchRoundReport(roundId) {
  if (!roundId) {
    throw new Error("RoundId vacío");
  }


  const cid = await ipfsContract.roundReports(roundId);
  if (!cid || cid.length === 0) {
    throw new Error("No hay CID almacenado para esa ronda");
  }


  const url = `http://127.0.0.1:8080/ipfs/${cid}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`IPFS devolvió ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error("El contenido en IPFS no es JSON válido");
  }

  return { cid, data };
}

function App() {
  const [roundId, setRoundId] = useState("");
  const [cid, setCid] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum
        .request({ method: "eth_requestAccounts" })
        .catch(() => {});
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setCid("");
    setReport(null);

    const idNum = Number(roundId);
    if (!idNum || idNum <= 0) {
      setErrorMsg("Introduce un roundId válido (entero > 0).");
      return;
    }

    setLoading(true);
    try {
      const { cid, data } = await fetchRoundReport(idNum);
      setCid(cid);
      setReport(data);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Error consultando la ronda.");
    } finally {
      setLoading(false);
    }
  };

  const outcomeYes =
    report && Object.prototype.hasOwnProperty.call(report, "outcomeYes")
      ? report.outcomeYes
      : report &&
        report.round &&
        Object.prototype.hasOwnProperty.call(report.round, "outcomeYes")
      ? report.round.outcomeYes
      : null;

  const totalYesNet =
    report && report.round && report.round.totalYesNet !== undefined
      ? report.round.totalYesNet
      : report && report.totalYesNet !== undefined
      ? report.totalYesNet
      : undefined;

  const totalNoNet =
    report && report.round && report.round.totalNoNet !== undefined
      ? report.round.totalNoNet
      : report && report.totalNoNet !== undefined
      ? report.totalNoNet
      : undefined;

  const priceStart =
    report && report.btcStartPriceUsd !== undefined
      ? report.btcStartPriceUsd
      : report && report.startPriceUsd !== undefined
      ? report.startPriceUsd
      : null;

  const priceEnd =
    report && report.btcEndPriceUsd !== undefined
      ? report.btcEndPriceUsd
      : report && report.endPriceUsd !== undefined
      ? report.endPriceUsd
      : null;

  return (
    <div className="App">
      <header className="App-header">
        {/* Barra superior */}
        <div className="app-topbar">
          <img src={logo} className="App-logo" alt="Ethereum logo" />
          <div className="app-title-block">
            <h1>BetHouse Round Explorer</h1>
            <p>
              Consulta los reportes de rondas guardados en IPFS + Ethereum
              (IpfsRoundStorage).
            </p>
          </div>
        </div>

        {/* Tarjeta principal */}
        <div className="card">
          <div className="card-header">
            <h2>Consultar ronda por ID</h2>
            <span>
              Storage: <code>{addresses.ipfs}</code>
            </span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <label htmlFor="round-input">Round ID</label>
              <input
                id="round-input"
                className="input-round"
                type="number"
                min="1"
                step="1"
                value={roundId}
                onChange={(e) => setRoundId(e.target.value)}
                placeholder="Ej. 1"
              />
              <button className="btn" type="submit" disabled={loading}>
                <span className="icon">🔍</span>
                {loading ? "Consultando..." : "Consultar"}
              </button>
            </div>
          </form>

          {/* Estado */}
          <div className="status-line">
            <span className="status-dot" />
            {loading && <span>Buscando CID y descargando reporte...</span>}
            {!loading && !errorMsg && !report && (
              <span>
                Introduce un <strong>roundId</strong> y pulsa "Consultar".
              </span>
            )}
            {errorMsg && <span className="status-error">{errorMsg}</span>}
          </div>

          {/* Resumen + JSON */}
          {cid && report && (
            <>
              <div className="round-summary">
                <div>
                  <strong>Round ID:</strong> {roundId}
                </div>

                <div>
                  <strong>Outcome:</strong>{" "}
                  {outcomeYes === null ? (
                    <span className="tag tag-fail">Desconocido</span>
                  ) : outcomeYes ? (
                    <span className="tag tag-success">YES</span>
                  ) : (
                    <span className="tag tag-fail">NO</span>
                  )}
                </div>

                {totalYesNet !== undefined && (
                  <div>
                    <strong>Total YES neto:</strong> {String(totalYesNet)}
                  </div>
                )}

                {totalNoNet !== undefined && (
                  <div>
                    <strong>Total NO neto:</strong> {String(totalNoNet)}
                  </div>
                )}

                {priceStart !== null && (
                  <div>
                    <strong>BTC inicio:</strong> {priceStart} USD
                  </div>
                )}

                {priceEnd !== null && (
                  <div>
                    <strong>BTC final:</strong> {priceEnd} USD
                  </div>
                )}
              </div>

              <div className="json-container">
                <div className="json-header">
                  <span>Reporte completo (JSON)</span>
                  <a
                    href={`http://127.0.0.1:8080/ipfs/${cid}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver en IPFS
                  </a>
                </div>
                <pre className="json-body">
                  {JSON.stringify(report, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      </header>
    </div>
  );
}

export default App;


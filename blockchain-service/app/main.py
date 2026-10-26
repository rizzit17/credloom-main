from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from .api.routes import router

app = FastAPI(
    title="Credloom Blockchain Service",
    description="Bridges REST to the Credloom smart contracts (ReputationRegistry, InsurancePool, "
    "LoanEscrow, LenderLiquidityPool) and exposes a chain explorer.",
    version="2.0.0",
)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/")
def root():
    return {"service": "credloom-blockchain-service", "docs": "/docs"}

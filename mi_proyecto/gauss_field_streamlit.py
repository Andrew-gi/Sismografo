import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle
import streamlit as st


MU0_OVER_4PI = 1e-7


def dipole_field(x, y, dipoles):
    bx = np.zeros_like(x, dtype=float)
    by = np.zeros_like(y, dtype=float)

    for x0, y0, mx, my in dipoles:
        rx = x - x0
        ry = y - y0
        r2 = rx**2 + ry**2
        r = np.sqrt(r2)
        r = np.maximum(r, 0.15)
        r_hat_x = rx / r
        r_hat_y = ry / r
        m_dot_r = mx * r_hat_x + my * r_hat_y
        factor = MU0_OVER_4PI / (r**3)
        bx += factor * (3 * m_dot_r * r_hat_x - mx)
        by += factor * (3 * m_dot_r * r_hat_y - my)

    return bx, by


def build_dipoles(mode, moment, offset):
    if mode == "Iman dividido":
        return [
            (-offset, 0.0, moment * 0.58, 0.0),
            (offset, 0.0, moment * 0.58, 0.0),
        ]
    return [(offset, 0.0, moment, 0.0)]


st.set_page_config(page_title="Gauss magnetico interactivo", layout="wide")
st.title("Ley de Gauss para el magnetismo")
st.caption("Visualizacion analitica con Python, Matplotlib y Streamlit.")

with st.sidebar:
    st.header("Controles")
    mode = st.selectbox(
        "Configuracion",
        ["Esfera gaussiana", "Cubo gaussiano", "Iman dividido"],
    )
    moment = st.slider("Momento dipolar m", 20.0, 280.0, 120.0, 1.0)
    offset = st.slider("Desplazamiento / separacion", 0.0, 1.8, 0.45, 0.01)
    gaussian_size = st.slider("Tamano de superficie gaussiana", 0.8, 2.8, 1.5, 0.01)
    density = st.slider("Densidad de lineas", 0.7, 2.0, 1.1, 0.1)
    show_heatmap = st.checkbox("Mostrar mapa de calor de |B|", value=True)

grid = np.linspace(-3.2, 3.2, 180)
x, y = np.meshgrid(grid, grid)
dipoles = build_dipoles(mode, moment, offset)
bx, by = dipole_field(x, y, dipoles)
bmag = np.sqrt(bx**2 + by**2)

sample_t = np.linspace(0, 2 * np.pi, 720, endpoint=False)
if mode == "Cubo gaussiano":
    half = gaussian_size
    top_x = np.linspace(-half, half, 220)
    side_y = np.linspace(-half, half, 220)
    boundary_points = np.concatenate([
        np.column_stack([top_x, np.full_like(top_x, half)]),
        np.column_stack([np.full_like(side_y, half), side_y[::-1]]),
        np.column_stack([top_x[::-1], np.full_like(top_x, -half)]),
        np.column_stack([np.full_like(side_y, -half), side_y]),
    ])
else:
    boundary_points = np.column_stack([
        gaussian_size * np.cos(sample_t),
        gaussian_size * np.sin(sample_t),
    ])

boundary_bx, boundary_by = dipole_field(
    boundary_points[:, 0][:, None],
    boundary_points[:, 1][:, None],
    dipoles,
)
normals = []
if mode == "Cubo gaussiano":
    for px, py in boundary_points:
        if np.isclose(px, gaussian_size):
            normals.append([1.0, 0.0])
        elif np.isclose(px, -gaussian_size):
            normals.append([-1.0, 0.0])
        elif np.isclose(py, gaussian_size):
            normals.append([0.0, 1.0])
        else:
            normals.append([0.0, -1.0])
    normals = np.array(normals)
    ds = (8 * gaussian_size) / len(boundary_points)
else:
    normals = boundary_points / np.maximum(np.linalg.norm(boundary_points, axis=1, keepdims=True), 1e-9)
    ds = (2 * np.pi * gaussian_size) / len(boundary_points)

normal_flux = (boundary_bx[:, 0] * normals[:, 0] + boundary_by[:, 0] * normals[:, 1]) * ds
out_flux = normal_flux[normal_flux > 0].sum()
in_flux = normal_flux[normal_flux < 0].sum()
net_flux = normal_flux.sum()

col_plot, col_info = st.columns([2.25, 1.0])

with col_plot:
    fig, ax = plt.subplots(figsize=(9, 7))
    fig.patch.set_facecolor("#0a1018")
    ax.set_facecolor("#0f1b2a")

    if show_heatmap:
        image = ax.imshow(
            np.log10(np.maximum(bmag, 1e-12)),
            extent=[grid.min(), grid.max(), grid.min(), grid.max()],
            origin="lower",
            cmap="magma",
            alpha=0.48,
        )
        cbar = plt.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
        cbar.ax.tick_params(colors="#e8f4ff")
        cbar.set_label("log10 |B|", color="#e8f4ff")

    ax.streamplot(
        x,
        y,
        bx,
        by,
        color=bmag,
        cmap="cool",
        density=density,
        linewidth=1.1,
        arrowsize=1.0,
    )

    if mode == "Cubo gaussiano":
        ax.add_patch(
            Rectangle(
                (-gaussian_size, -gaussian_size),
                2 * gaussian_size,
                2 * gaussian_size,
                fill=False,
                linewidth=2.0,
                edgecolor="#c084fc",
                linestyle="--",
            )
        )
    else:
        ax.add_patch(
            Circle(
                (0.0, 0.0),
                gaussian_size,
                fill=False,
                linewidth=2.0,
                edgecolor="#7dd3fc",
                linestyle="--",
            )
        )

    for index, (x0, y0, mx, _my) in enumerate(dipoles):
        north_color = "#fb7185" if index == 0 else "#facc15"
        south_color = "#2563eb"
        ax.plot([x0 - 0.32, x0], [y0, y0], color=south_color, linewidth=8, solid_capstyle="round")
        ax.plot([x0, x0 + 0.32], [y0, y0], color=north_color, linewidth=8, solid_capstyle="round")

    ax.set_title("Lineas de campo cerradas y superficie gaussiana", color="#e8f4ff", pad=12)
    ax.set_xlabel("x", color="#e8f4ff")
    ax.set_ylabel("y", color="#e8f4ff")
    ax.tick_params(colors="#c7d8ea")
    ax.set_aspect("equal")
    ax.set_xlim(-3.0, 3.0)
    ax.set_ylim(-3.0, 3.0)
    st.pyplot(fig, clear_figure=True)

with col_info:
    st.subheader("Lecturas")
    st.metric("Flujo saliente", f"{out_flux:.3e} Wb")
    st.metric("Flujo entrante", f"{in_flux:.3e} Wb")
    st.metric("Flujo neto", f"{net_flux:.3e} Wb")
    st.metric("Campo medio |B|", f"{np.mean(bmag) * 1e6:.3e} uT")
    st.info(
        "La suma del flujo que entra y sale de la superficie gaussiana tiende a cero porque las lineas del campo magnetico forman lazos cerrados."
    )
    if mode == "Iman dividido":
        st.warning(
            "Dividir el iman no crea monopolos magneticos: siguen apareciendo polos norte y sur, y el flujo neto se mantiene cercano a cero."
        )

st.code("streamlit run gauss_field_streamlit.py", language="bash")

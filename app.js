const express = require('express');
const app = express();
const { pool } = require('./config');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const flash = require('express-flash');
const passport = require('passport');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const initializePassport = require('./pswConfig');
const { checkRole } = require('./middleware'); // Importa el middleware de verificación de roles

const guardarRegistroDescarga = require('./guardarRegistroDescarga');// Importa la función para guardar registros
const { Console } = require('console');
const { format } = require('date-fns');


initializePassport(passport);
app.use(express.urlencoded({ extended: false }));
app.engine('html', ejs.renderFile); // Establece el motor de plantillas para archivos ".html"
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));
//app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(
  session({
    secret: 'secret',
    resave: 'false,',
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.get('/', (req, res) => {
  res.render('login');
});

app.get('/users/register', checkNotAuthenticated,checkRole('root'), (req, res) => {
  res.render('register');
});
app.get('/users/login', checkAuthenticated, (req, res) => {
  res.render('login');
});

app.get('/users/dashboard', checkNotAuthenticated, (req, res) => {
  res.render('dashboard', { user: req.user.name });
});

//Rutas por roles de la base de datos

app.get('/admin', checkNotAuthenticated, checkRole('admin'), (req, res) => {
  res.render('admin', { user: req.user.name });
});
app.get('/root', checkNotAuthenticated, checkRole('root'), (req, res) => {
  res.render('root', { user: req.user.name });
});
app.get('/editor', checkNotAuthenticated, checkRole('editor'), (req, res) => {
  res.render('editor', { user: req.user.name });
});
app.get('/lector', checkNotAuthenticated, checkRole('lector'), (req, res) => {
  res.render('lector', { user: req.user.name });
});


app.get('/users/geoport', checkNotAuthenticated, (req, res) => {
  console.log(req.user.role_name)
  res.render('geoport', { user: req.user.name, role:req.user.role_name});
});


app.get('/users/umadis', checkNotAuthenticated, (req, res) => {
  console.log(req.user.role_name)
  res.render('umadis', { user: req.user.name, role:req.user.role_name});
});

app.get('/users/registros', checkNotAuthenticated, (req, res) => {
  console.log(req.user.role_name)
  res.render('registrosUmadis', { user: req.user.name, role:req.user.role_name});
});


app.get('/users/logout', (req, res) => {
  // req.logout();
  //res.render('index', { message: 'You have logged out successfully' });
  req.logout(function (err) {
    if (err) {
      console.error(err);

    }
    // Redirige al usuario a la página principal u otra página después de cerrar sesión
    res.redirect('/users/login');
  });
});

app.post('/users/register', async (req, res) => {
  let { name, username, password, password_confirm, role } = req.body; // Añadir role
  let errors = [];

  if (!name || !username || !password || !password_confirm || !role) {
    errors.push({ message: 'Please enter all fields correctly' });
  }
  if (password.length < 6) {
    errors.push({ message: 'Password must be at least 6 characters long' });
  }
  if (password !== password_confirm) {
    errors.push({ message: 'Passwords do not match' });
  }
  if (errors.length > 0) {
    res.render('register', { errors, name, username, password, password_confirm, role });
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    pool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username],
      (err, results) => {
        if (err) {
          console.log(err);
        } if (results.rows.length > 0) {
          return res.render('register', {
            message: 'Username already registered'
          });
        } else {
          pool.query(
            `SELECT id FROM roles WHERE role_name = $1`,
            [role],
            (err, results) => {
              if (err) {
                throw err;
              }
              if (results.rows.length === 0) {
                return res.render('register', {
                  message: 'Role not found'
                });
              }
              const roleId = results.rows[0].id;
              pool.query(
                `INSERT INTO users (name, username, password, role_id)
                VALUES ($1, $2, $3, $4)
                RETURNING id, password`,
                [name, username, hashedPassword, roleId],
                (err, results) => {
                  if (err) {
                    throw err;
                  }
                  req.flash('success_msg', 'You are successfully registered');
                  res.redirect('/users/umadis');
                }
              );
            }
          );
        }
      }
    );
  }
});

app.post(
  '/users/login',
  passport.authenticate('local', {
    successRedirect: '/users/umadis',
   // successRedirect: '/users/mantenimiento',
    failureRedirect: '/users/login',
    failureFlash: true,
  })
);

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/users/umadis');
  }
  next();
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/users/login');
}

app.post('/registrar_atencion', async (req, res) => {
  const client = await pool.connect();
  let {
    nombre_apellido,
    edad,
    nacimiento_dia,
    nacimiento_mes,
    nacimiento_anio,
    distrito,
    direccion,
    ocupacion,
    ci,
    persona_referencia,
    telefono,
    carnet_discapacidad,
    tipo_discapacidad_id,
    motivo_consulta,
    acciones,
    apoyos,
    familiares
  } = req.body;

  let errors = [];

  // Validación básica
  if (!nombre_apellido || !edad || !ci) {
    errors.push({ message: 'Por favor complete todos los campos obligatorios' });
  }

  if (errors.length > 0) {
    return res.render('formulario', { errors }); // Renderiza la vista con errores
  }

  try {
    await client.query('BEGIN');

    // Insertar persona
    const insertPersonaQuery = `
      INSERT INTO atencion_persona (
        nombre_apellido, edad, nacimiento_dia, nacimiento_mes, nacimiento_anio,
        distrito, direccion, ocupacion, ci, persona_referencia, telefono,
        carnet_discapacidad, tipo_discapacidad_id, motivo_consulta
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
    `;

    const personaValues = [
      nombre_apellido, edad, nacimiento_dia, nacimiento_mes, nacimiento_anio,
      distrito, direccion, ocupacion, ci, persona_referencia, telefono,
      carnet_discapacidad, tipo_discapacidad_id, motivo_consulta
    ];

    const result = await client.query(insertPersonaQuery, personaValues);
    const personaId = result.rows[0].id;

    // Insertar familiares (si hay)
    if (Array.isArray(familiares)) {
      for (const fam of familiares) {
        await client.query(
          `INSERT INTO grupo_familiar (atencion_id, nombre_apellido, parentesco, edad, telefono, observaciones)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [personaId, fam.nombre, fam.parentesco, fam.edad, fam.telefono, fam.observaciones]
        );
      }
    }

    // Insertar acciones inmediatas
    if (Array.isArray(acciones)) {
      for (const acc of acciones) {
        await client.query(
          `INSERT INTO acciones_inmediatas (atencion_id, descripcion)
           VALUES ($1, $2)`,
          [personaId, acc]
        );
      }
    }

    // Insertar apoyos requeridos
    if (Array.isArray(apoyos)) {
      for (const ap of apoyos) {
        await client.query(
          `INSERT INTO apoyo_requerido (atencion_id, area, observaciones)
           VALUES ($1, $2, $3)`,
          [personaId, ap.area, ap.observaciones || '']
        );
      }
    }

    await client.query('COMMIT');
    req.flash('success_msg', 'Registro guardado exitosamente');
    res.redirect('/users/umadis'); // o a donde quieras redirigir

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al registrar:', err);
    req.flash('error_msg', 'Hubo un error al guardar el registro');
    res.redirect('/users/umadis');
  } finally {
    client.release();
  }
});


app.get('/api/personas', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre_apellido FROM atencion_persona ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar personas' });
  }
});





app.get('/api/personas/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const persona = await pool.query(
      `SELECT p.*, d.nombre AS tipo_discapacidad
       FROM atencion_persona p
       LEFT JOIN tipo_discapacidad d ON p.tipo_discapacidad_id = d.id
       WHERE p.id = $1`,
      [id]
    );

    const familiares = await pool.query(
      `SELECT nombre_apellido, parentesco, edad FROM grupo_familiar WHERE atencion_id = $1`,
      [id]
    );

    const acciones = await pool.query(
      `SELECT descripcion FROM acciones_inmediatas WHERE atencion_id = $1`,
      [id]
    );

    const apoyos = await pool.query(
      `SELECT area, observaciones FROM apoyo_requerido WHERE atencion_id = $1`,
      [id]
    );

    res.json({
      ...persona.rows[0],
      familiares: familiares.rows,
      acciones: acciones.rows,
      apoyos: apoyos.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener detalles' });
  }
});




// redirect  
app.get('/users/21', checkNotAuthenticated, (req, res) => { 
  res.render('21', { user: req.user.name , role:req.user.role_name}); 
});
app.get('/users/help2', checkNotAuthenticated, (req, res) => { 
  res.render('help2', { user: req.user.name, role:req.user.role_name }); 
});


// Nueva ruta para descargar archivos y registrar la descarga
app.get('/users/descargar/:nombreArchivo', checkNotAuthenticated, (req, res) => {
  const nombreArchivo =  req.params.nombreArchivo;
  console.log(nombreArchivo)
  const rutaArchivo = path.resolve(__dirname, 'public/ORTOFOTOS', nombreArchivo); // Ajusta esta ruta a la ubicación real de tus archivos
  
  //console.log(rutaArchivo)
  if (!fs.existsSync(rutaArchivo)) {
  
    return res.status(404).send('Archivo no encontrado.');
  }
  
  const registroDescarga = {
    usuario_id: req.user ? req.user.id : null,  
    ip: req.ip,
    nombre_archivo: nombreArchivo,
    tamano_archivo: fs.statSync(rutaArchivo).size,
    fecha_hora: new Date(),
    resultado: 'Iniciado'
  };
  
  res.download(rutaArchivo, async (err) => {
    if (err) {
      registroDescarga.resultado = 'Fallido';
      await guardarRegistroDescarga(registroDescarga);
      res.status(500).send("Error al descargar el archivo.");
    } else {
      registroDescarga.resultado = 'Éxito';
      await guardarRegistroDescarga(registroDescarga);
    }
  });
});


// Ruta para servir el archivo HTML con el formulario de descarga
app.get('/descargar-archivo', checkNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'descargar-archivo.html'));
});

app.get('/users/descargados', checkNotAuthenticated, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM descargas WHERE usuario_id = $1', [req.user.id]);
    
    // Convertir las fechas al formato 'YYYY-MM-DD HH:mm:ss.SSS'
    result.rows.forEach(row => {
      for (const key in row) {
        if (row[key] instanceof Date) {
          row[key] = format(row[key], 'yyyy-MM-dd HH:mm:ss.SSS');
        }
      }
    });
    
  //  console.log(result.rows);
    res.json(result.rows); // Enviar datos en formato JSON
  } catch (err) {
    console.error('Error al obtener las descargas:', err);
    res.status(500).send('Error al obtener las descargas');
  }
});


let port = process.env.PORT;
if (port == null || port == '') {
  port = 4200;
}
app.listen(port, function () {
  console.log(`Server has started successfully at ${port}`);
});
